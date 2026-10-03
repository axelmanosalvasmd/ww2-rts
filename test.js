// Headless sim checks: `node test.js`. Fails loudly if core rules break.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import * as sim from './shared/sim.js';
import { createGame, step, command, los, findPath, validateMap, snapshotFor, snapshotCache, inTrench, vet, spawnSlots, popOf, popCap, CFG, CELL, SUPPORT, UNITS, teamSees, levelOf } from './shared/sim.js';
import { SpatialGrid, updateGrid } from './shared/grid.js';
import { think, thinkEvery, AI_LEVEL_NAMES } from './shared/ai.js';
import { viewFor } from './shared/ai-view.js';
import { unitRole } from './client/unit-roles.js';
import { createRelief, TRENCH_DEPTH } from './client/relief.js';
import { createAutocast } from './client/autocast.js';
import { normalizeFace, slotSize, facingSpots } from './shared/formation.js';
import { createOrders } from './client/orders.js';

// Sight rays ending on a cell border must stop at the destination, including mixed-sign diagonals.
{
  const map = { w: 64, h: 64, rows: Array(64).fill('.'.repeat(64)), spawns: [{ x: 1, y: 1 }, { x: 60, y: 60 }], points: [] };
  const g = createGame(map, ['a', 'b'], false);
  const end = { x: 62, z: 92 };
  for (const dx of [-23, -22, -11, -2, -1, 0, 1, 2, 11, 22, 23]) for (const dz of [-23, -22, -11, -2, -1, 0, 1, 2, 11, 22, 23]) {
    const start = { x: end.x + dx, z: end.z + dz };
    assert.ok(los(g, start, end), `open border ray ${dx},${dz}`);
    assert.ok(los(g, end, start), `reverse open border ray ${dx},${dz}`);
  }
  const start = { x: 85, z: 69 };
  g.flags[40 * g.w + 37] |= sim.SIGHT;
  assert.equal(los(g, start, end), false, 'a wall on a border-ending ray still blocks sight');
  g.flags[40 * g.w + 37] &= ~sim.SIGHT;
  g.flags[45 * g.w + 30] |= sim.SIGHT;
  assert.ok(los(g, start, end), 'a wall beyond the endpoint must not block sight');
}

// Editor reachability uses terrain without a match's player or mine state.
{
  const g = { w: 20, h: 20, flags: new Uint16Array(400), height: new Int8Array(400) };
  const from = { x: 3, z: 3 }, to = { x: 35, z: 35 };
  assert.ok(findPath(g, from, to).length, 'the editor validates connected terrain without players');
  for (let y = 0; y < g.h; y++) g.flags[y * g.w + 10] = sim.MOVE;
  assert.equal(findPath(g, from, to).length, 0, 'the editor still rejects a blocked route');
}

// Routes pass a building with room to spare: a squad or tank ordered straight across a Classic HQ goes around it
// at least 2 m off its walls, not along its corner (their models would cut across it).
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 20, y: 40 }, { x: 70, y: 40 }], points: [] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq'), half = UNITS.hq.size * CELL / 2;
  const off = (p) => Math.hypot(Math.max(0, Math.abs(p.x - hq.x) - half), Math.max(0, Math.abs(p.z - hq.z) - half));
  for (const type of ['rifle', 'tank']) {
    const from = { owner: 0, type, x: hq.x - 12, z: hq.z + 0.3 }, path = findPath(g, from, { x: hq.x + 12, z: hq.z });
    let at = from, closest = Infinity;
    for (const q of path) { for (let k = 0; k <= 40; k++) closest = Math.min(closest, off({ x: at.x + (q.x - at.x) * k / 40, z: at.z + (q.z - at.z) * k / 40 })); at = q; }
    assert.ok(path.length && closest >= 1.9, `${type} keeps clear of the HQ (${closest.toFixed(2)} m)`);
  }
}

// A command bunker has no cells, but routes still go around it, and an order aimed at it still gets a path.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 4, y: 4 }, { x: 75, y: 75 }], points: [] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'annihilation' });
  const bunker = [...g.units.values()].find(u => u.owner === 0 && u.type === 'bunker');
  Object.assign(bunker, { x: 81, z: 81 });
  for (const type of ['rifle', 'tank']) {
    const from = { owner: 1, type, x: 65, z: 81.3 }, path = findPath(g, from, { x: 97, z: 81 });
    let at = from, closest = Infinity;
    for (const q of path) { for (let k = 0; k <= 40; k++) closest = Math.min(closest, Math.hypot(at.x + (q.x - at.x) * k / 40 - 81, at.z + (q.z - at.z) * k / 40 - 81)); at = q; }
    assert.ok(path.length && closest >= UNITS.bunker.radius + 1, `${type} goes around the bunker (${closest.toFixed(2)} m)`);
    assert.ok(findPath(g, from, bunker).length, `${type} can still be sent at the bunker`);
  }
}

// Spawn walking distances: a cliff (a step of more than one level) is in the way like water.
{
  const map = { w: 10, h: 5, rows: Array(5).fill('.'.repeat(10)), heights: Array(5).fill('00000' + '22222'), spawns: [{ x: 1, y: 2 }, { x: 8, y: 2 }], points: [] };
  assert.equal(sim.spawnDistances(map, [0, 1])[0][1], 28, 'no way up the cliff: four times the straight distance');
  map.heights = Array(5).fill('00000' + '11111');
  assert.equal(sim.spawnDistances(map, [0, 1])[0][1], 7, 'a one-level step is walkable');
}

// AI: an all-allied lobby is legal, so holding a point must not assume an enemy HQ exists.
{
  const map = { w: 20, h: 20, rows: Array(20).fill('.'.repeat(20)), spawns: [{ x: 1, y: 1 }, { x: 18, y: 18 }], points: [{ x: 10, y: 10 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 0]); g.players[0].mp = 1000;
  const u = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  Object.assign(u, { x: g.points[0].x, z: g.points[0].z }); g.points[0].owner = 0;
  assert.doesNotThrow(() => think(g, 0), 'AI holding an allied point without opponents does not crash');
}

// AI: a hidden plane over a destroyed HQ must not change purchasing at the surviving base.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 2, y: 2 }, { x: 77, y: 77 }], points: [{ x: 40, y: 40 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  g.units.delete(hq.id);
  const barracks = { ...hq, id: g.nextId++, type: 'barracks', x: 120, z: 120, hp: UNITS.barracks.hpPer, queue: [] };
  g.units.set(barracks.id, barracks);
  g.units.set(g.nextId, { ...barracks, id: g.nextId++, type: 'motorpool', hp: UNITS.motorpool.hpPer, queue: [] });
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  for (let i = 0; i < 2; i++) g.units.set(g.nextId, { ...rifle, id: g.nextId++, path: [] });
  for (const u of g.units.values()) if (u.owner === 0) Object.assign(u, { x: 120, z: 120 });
  // Two Engineers satisfy recruitment needs without assuming hidden node occupancy.
  const engineer = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  g.units.set(g.nextId, { ...engineer, id: g.nextId++, path: [] });
  const mode = g.mode; g.mode = null; g.players[1].mp = 1000;
  command(g, 1, { t: 'buy', unit: 'fighter' }); g.mode = mode;
  const plane = [...g.units.values()].find(u => u.type === 'fighter');
  Object.assign(plane, g.players[0].spawn); plane.air.state = 'out';
  assert.ok([...g.units.values()].filter(u => u.owner === 0).every(u => Math.hypot(u.x - plane.x, u.z - plane.z) > CFG.air.seeRange), 'plane is outside all friendly observers');
  assert.ok(!snapshotFor(g, 0, []).units.some(u => u[0] === plane.id), 'plane over the old HQ is hidden from the AI team');
  g.players[0].mp = 200; think(g, 0, { adaptive: false });
  assert.deepEqual(barracks.queue, ['mg'], 'AI ignores hidden planes when reserving money for flak');
}

// Fog: building footprints follow the same visibility and memory rules as the buildings themselves.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 2, y: 2 }, { x: 77, y: 77 }], points: [{ x: 40, y: 40 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const eng = [...g.units.values()].find(u => u.owner === 1 && u.type === 'engineer');
  const scout = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  g.players[1].mp = 1000;
  command(g, 1, { t: 'build', ids: [eng.id], kind: 'barracks', x: 140, z: 140 }); step(g);
  const b = [...g.units.values()].find(u => u.owner === 1 && u.type === 'barracks');
  assert.ok(b && !g.players[0].visible.has(b.id), 'enemy Construction Site is outside friendly vision');
  const hidden = snapshotFor(g, 0, [], g.newCells);
  assert.ok(!hidden.cells.some(([c]) => b.cells.includes(c)), 'hidden building footprint cells are absent from snapshots');
  Object.assign(scout, { x: 130, z: 140 }); for (let i = 0; i < 4; i++) step(g);
  assert.ok(g.players[0].visible.has(b.id), 'scout discovers the enemy building');
  g.newCells = [];
  const seen = snapshotFor(g, 0, [], []);
  assert.equal(seen.cells.filter(([c, ch]) => b.cells.includes(c) && ch === 'K').length, 9, 'discovering a building sends its complete footprint without new terrain changes');
  Object.assign(scout, g.players[0].spawn); for (let i = 0; i < 4; i++) step(g);
  b.hp = 0; step(g);
  const gone = snapshotFor(g, 0, [], g.newCells);
  assert.ok(!gone.cells.some(([c]) => b.cells.includes(c)), 'unseen building destruction does not change remembered terrain');
  assert.ok(gone.ghosts.some(gh => gh[0] === b.id), 'unseen building destruction preserves its Ghost');
  assert.equal(sim.terrainFor(g, 0, true).filter(([c, ch]) => b.cells.includes(c) && ch === 'K').length, 9, 'reconnect terrain remembers the old footprint under fog');
  Object.assign(scout, { x: 130, z: 140 }); while (g.tick % 4 !== 1) step(g);
  const revisited = snapshotFor(g, 0, [], []);
  assert.equal(revisited.cells.filter(([c, ch]) => b.cells.includes(c) && ch === 'R').length, 9, 'revisiting a destroyed building catches up all rubble cells');
  assert.ok(!revisited.ghosts.some(gh => gh[0] === b.id), 'revisiting the rubble clears its Ghost');
  assert.ok(sim.terrainFor(g, 0, true).length <= g.w * g.h, 'remembered terrain is bounded by the map cell count');
}

// Recruitment descriptions stay readable when the roster gains a unit without role copy.
{
  assert.equal(unitRole('flak', 'Flak Gun'), 'Shoots down enemy air support', 'Flak has a role description');
  assert.equal(unitRole('rifle', 'Rifle Squad'), 'Captures, all-round', 'existing role copy is preserved');
  assert.equal(unitRole('fieldgun', 'Field Gun'), 'Field Gun', 'missing roles use the unit name');
  assert.equal(unitRole('fieldgun'), 'Unit', 'missing names still produce readable text');
  assert.equal(unitRole('toString', 'Field Gun'), 'Field Gun', 'inherited properties are not role descriptions');
  for (const [type, def] of Object.entries(UNITS).filter(([, def]) => !def.structure)) {
    const role = unitRole(type, def.name);
    assert.equal(typeof role, 'string', `${type}: role is text`);
    assert.ok(role.trim() && role !== 'undefined', `${type}: role is readable`);
  }
}

const blank = (rows) => ({ w: rows[0].length, h: rows.length, rows, spawns: [{ x: 1, y: 1 }, { x: 18, y: 1 }, { x: 1, y: 18 }], points: [{ x: 10, y: 10 }] });
const empty = Array(20).fill('.'.repeat(20));
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) step(g); };
const fresh = (rows = empty, n = 2) => { const g = createGame(blank(rows), ['a', 'b', 'c'].slice(0, n), false); g.units.clear(); g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 })); return g; };
const UNITS_COST = (t) => ({ rifle: 100, mg: 150, at: 200, tank: 300, rocket: 250, ranger: 200, tiger: 560, conscript: 80 })[t];
// put: tests set hp by hand, so a placed unit keeps still instead of auto-retreating (it starts on in a real match)
const put = (g, owner, type, x, z) => { command(g, owner, { t: 'buy', unit: type }); const u = [...g.units.values()].at(-1); u.x = x; u.z = z; u.autoRetreat = false; return u; };
{
  const g = fresh(); g.players[0].mp = 1000; command(g, 0, { t: 'buy', unit: 'rifle' });
  assert.ok([...g.units.values()].at(-1).autoRetreat, 'a bought squad starts with auto-retreat on');
}

// LOS: a building between two points blocks sight; a wall does not.
{
  const rows = [...empty]; rows[5] = '.....B' + '.'.repeat(14); rows[7] = '.....#' + '.'.repeat(14);
  const g = fresh(rows);
  assert.equal(los(g, { x: 1, z: 11 }, { x: 21, z: 11 }), false, 'building blocks LOS');
  assert.equal(los(g, { x: 1, z: 15 }, { x: 21, z: 15 }), true, 'wall does not block LOS');
}

// Pathfinding routes around a wall of buildings.
{
  const rows = [...empty]; for (let y = 0; y < 15; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows);
  const path = findPath(g, { x: 5, z: 5 }, { x: 35, z: 5 });
  assert.ok(path.length >= 2, 'path found');
  assert.ok(path.some(p => p.z > 15 * CELL), 'path goes around the building column');
}

// Jam recovery keeps terrain corners when the next waypoint is obstructed.
{
  const rows = [...empty]; rows[6] = '......B' + '.'.repeat(13);
  const g = fresh(rows); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 11, 11), corner = { x: 11, z: 15 }, end = { x: 17, z: 15 };
  u.path = [corner, end]; u.was = { x: u.x, z: u.z }; u.jam = 3.1;
  step(g);
  assert.equal(u.path[0], corner, 'three seconds of crowding never skips a required corner');
  assert.equal(u.x, 11, 'the squad keeps moving along the clear leg');
  run(g, 3);
  assert.ok(Math.hypot(u.x - end.x, u.z - end.z) < 1, 'the route still reaches its destination around the building');
}

// Movement: a move order gets the unit there.
{
  const g = fresh(); g.players[0].mp = 1000;
  const u = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'move', orders: [[u.id, 30, 30]] });
  run(g, 10);
  assert.ok(Math.hypot(u.x - 30, u.z - 30) < 1, `rifle arrived (${u.x},${u.z})`);
}

// Combat + fog: in range and in sight, squads damage each other; MG suppresses.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const r = put(g, 0, 'rifle', 5, 5), m = put(g, 1, 'mg', 25, 5);
  run(g, 5);
  assert.ok(r.hp < 100, 'rifle took damage');
  assert.ok(r.supp > 40, `mg suppressed rifle (${r.supp})`);
  assert.ok(snapshotFor(g, 0, []).units.some(x => x[0] === m.id), 'enemy MG visible to player 0');
}

// Fog: an enemy behind a building is not in the snapshot.
{
  const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  put(g, 0, 'rifle', 5, 5); const hidden = put(g, 1, 'rifle', 30, 5);
  run(g, 1);
  assert.ok(!snapshotFor(g, 0, []).units.some(x => x[0] === hidden.id), 'hidden enemy filtered out');
}

// Rear armor: AT shot from behind does double damage.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const t = put(g, 1, 'tank', 20, 20); t.rot = 0; // facing +x
  const orig = Math.random; Math.random = () => 0;
  const a = put(g, 0, 'at', 0, 20); a.still = 5; // behind the tank
  run(g, 0.2);
  Math.random = orig;
  assert.equal(t.hp, 360 - 240, 'rear hit = 2x AT damage');
}

// Capture, VP and win.
{
  const g = fresh(); g.players[0].mp = 1000;
  put(g, 0, 'rifle', 21, 21);
  run(g, CFG.captureTime + 1);
  assert.equal(g.points[0].owner, 0, 'point captured');
  run(g, CFG.vpToWin + 5);
  assert.equal(g.winner, 0, 'player 0 wins on VP');
}

// Buying: costs manpower, rejects junk.
{
  const g = fresh(); g.players[0].mp = 150;
  command(g, 0, { t: 'buy', unit: 'rifle' }); command(g, 0, { t: 'buy', unit: 'tank' }); command(g, 0, { t: 'buy', unit: '__proto__' });
  command(g, 0, { t: 'move', orders: [[999, NaN, 'x'], 'junk'] });
  assert.equal(g.units.size, 1); assert.equal(g.players[0].mp, 50);
}

// Commands require an active player's numeric slot, including direct simulation callers.
{
  const g = fresh(); g.players[0].mp = 1000;
  for (const slot of [-1, 2, null, '0', NaN, Infinity]) {
    assert.doesNotThrow(() => command(g, slot, { t: 'buy', unit: 'rifle' }), `invalid player slot ${slot} does not throw`);
    assert.equal(g.units.size, 0, `invalid player slot ${slot} cannot buy`);
  }
  const p = g.players[0];
  for (const state of ['out', 'away']) {
    p[state] = true;
    command(g, 0, { t: 'buy', unit: 'rifle' });
    command(g, 0, { t: 'support', kind: 'dive', x: 20, z: 20 });
    assert.equal(g.units.size, 0, `${state} player cannot buy`);
    assert.equal(g.strikes.length, 0, `${state} player cannot call support`);
    assert.equal(p.mp, 1000, `${state} commands do not spend manpower`);
    p[state] = false;
  }
}

// Unit names are strings, rather than values coerced into table keys.
{
  const g = fresh(); g.players[0].mp = 1000;
  for (const unit of [{ toString: null, valueOf: null }, ['rifle'], 'toString', '__proto__']) {
    assert.doesNotThrow(() => command(g, 0, { t: 'buy', unit }), 'malformed unit names do not throw');
    assert.equal(g.units.size, 0, 'malformed unit names cannot recruit');
    assert.equal(g.players[0].mp, 1000, 'malformed unit names do not spend manpower');
  }
}

// Support names are strings and inherited table keys are rejected.
{
  const g = fresh(); g.players[0].mp = 1000;
  for (const kind of [{ toString: null, valueOf: null }, ['dive'], 'toString', '__proto__']) {
    assert.doesNotThrow(() => command(g, 0, { t: 'support', kind, x: 20, z: 20 }), 'malformed support names do not throw');
    assert.equal(g.strikes.length, 0, 'malformed support names cannot call strikes');
    assert.equal(g.players[0].mp, 1000, 'malformed support names do not spend manpower');
  }
}

// Fortification names are strings and inherited table keys are rejected.
{
  const g = fresh(); g.players[0].mp = 1000;
  const u = put(g, 0, 'rifle', 10, 10), mp = g.players[0].mp;
  for (const kind of [{ toString: null, valueOf: null }, ['trench'], 'toString', '__proto__']) {
    assert.doesNotThrow(() => command(g, 0, { t: 'dig', ids: [u.id], kind, x: 20, z: 20 }), 'malformed fortification names do not throw');
    assert.equal(u.dig, null, 'malformed fortification names cannot start digging');
    assert.equal(g.players[0].mp, mp, 'malformed fortification names do not spend manpower');
  }
}

// Explicit recruitment buildings must be valid owned makers rather than falling back to another building.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.type === 'hq' && u.owner === 0), enemy = [...g.units.values()].find(u => u.type === 'hq' && u.owner === 1);
  const engineer = [...g.units.values()].find(u => u.type === 'engineer' && u.owner === 0);
  g.players[0].mp = 1000;
  for (const from of [enemy.id, engineer.id, String(hq.id), NaN, Infinity, null, 0, {}]) {
    command(g, 0, { t: 'buy', unit: 'rifle', from });
    assert.equal(hq.queue.length, 0, 'invalid recruitment building does not fall back to the HQ');
    assert.equal(g.players[0].mp, 1000, 'invalid recruitment building does not spend manpower');
  }
  command(g, 0, { t: 'buy', unit: 'rifle', from: hq.id });
  assert.deepEqual(hq.queue, ['rifle'], 'valid explicit recruitment building works');
  command(g, 0, { t: 'buy', unit: 'rifle' });
  assert.equal(hq.queue.length, 2, 'unspecified recruitment building chooses an owned maker');
}

// Retreat: sprints home, takes a quarter of the damage, stops shooting.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  g.players[0].spawn = { x: 5, z: 38 };
  const r = put(g, 0, 'rifle', 5, 5), t = put(g, 1, 'tank', 20, 5);
  command(g, 0, { t: 'retreat', ids: [r.id] });
  assert.ok(r.retreating && r.path.length, 'retreat order sets a path home');
  const orig = Math.random; Math.random = () => 0;
  t.cooldown = 0; run(g, 0.3);
  Math.random = orig;
  assert.equal(r.hp, 100 - 30 * 0.25, 'retreating squad takes 25% damage');
  assert.equal(r.targetId, 0, 'retreating squad does not fire');
}

// Reinforce: a damaged squad at its spawn regains models for manpower.
{
  const g = fresh(); g.players[0].mp = 1000;
  g.players[0].spawn = { x: 20, z: 20 };
  const r = put(g, 0, 'rifle', 21, 21); r.hp = 40;
  const mp = g.players[0].mp;
  run(g, 5);
  assert.equal(r.hp, 80, 'two models restored in 5s');
  assert.ok(Math.abs(mp - g.players[0].mp - 2 * 10) < 25, 'reinforcing costs manpower'); // income runs meanwhile
}

// Grenade: walks into range, throws, blast hurts everyone nearby (cover doesn't help).
{
  const rows = [...empty]; rows[2] = '.'.repeat(15) + '#' + '.'.repeat(4);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const r = put(g, 0, 'rifle', 3, 5), m = put(g, 1, 'mg', 31, 5);
  command(g, 0, { t: 'ability', ids: [r.id], x: 31, z: 5 });
  const before = m.hp;
  run(g, 4);
  assert.ok(r.cd > 0, 'grenade on cooldown');
  assert.ok(m.hp <= before - 30 || !g.units.has(m.id), `mg hit by grenade (${m.hp})`);
}

// Smoke blocks line of sight.
{
  const g = fresh(); g.players[0].mp = 1000;
  const t = put(g, 0, 'tank', 20, 20);
  assert.ok(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }));
  command(g, 0, { t: 'ability', ids: [t.id] });
  assert.equal(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), false, 'smoke blocks LOS');
  assert.ok(los(g, { x: 20 - CFG.smokeSight + 1, z: 20 }, { x: 20, z: 20 }), 'a unit close by sees into the smoke');
  run(g, 15);
  assert.ok(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), 'smoke clears');
}
// Conscripts take three quarters of a place in the army limit.
{
  const g = fresh(), before = popOf(g, 0);
  g.players[0].mp = 1000;
  for (let i = 0; i < 4; i++) put(g, 0, 'rifle', 20 + i * 4, 20).type = 'conscript';
  assert.equal(popOf(g, 0) - before, 3, 'four conscript squads count as three');
}

// Catch-up: trailing players earn more manpower.
{
  const g = fresh(); g.players[0].vp = 400;
  run(g, 0.1);
  assert.ok(g.players[1].inc > g.players[0].inc + 3, 'trailing player gets catch-up income');
}

// Support: costs MP, goes on cooldown, rejects junk, and is announced before it lands.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  command(g, 0, { t: 'support', kind: 'artillery', x: 30, z: 30 });
  command(g, 0, { t: 'support', kind: 'artillery', x: 30, z: 30 }); // on cooldown
  command(g, 0, { t: 'support', kind: 'nuke', x: 30, z: 30 });
  command(g, 0, { t: 'support', kind: 'recon', x: 'a', z: 30 });
  assert.equal(g.players[0].mp, 1000 - SUPPORT.artillery.cost);
  assert.equal(g.strikes.length, 1);
  assert.equal(snapshotFor(g, 1, []).strikes.length, 1, 'enemy sees the incoming barrage');
}

// Artillery: nothing before the delay, then shells wreck the area.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000;
  const r = put(g, 1, 'rifle', 20, 20);
  command(g, 0, { t: 'support', kind: 'artillery', x: 20, z: 20 });
  run(g, SUPPORT.artillery.delay - 0.5);
  assert.equal(r.hp, 100, 'no damage during the warning');
  const orig = Math.random; Math.random = () => 0.5; // shells land dead center (real barrages scatter)
  run(g, 6);
  Math.random = orig;
  assert.ok(r.hp < 100 || !g.units.has(r.id), 'barrage hits the squad');
  assert.equal(g.strikes.length, 0, 'barrage finished');
  const sunk = g.height.filter(l => l < 0).length;
  assert.ok(sunk > 1 && sunk <= 21, `ten shells on one spot sink the ground around it (${sunk} cells)`);
}

// Strafe: hits along the line, misses off it.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  const on = put(g, 1, 'rifle', 30, 20), off = put(g, 1, 'rifle', 30, 38);
  command(g, 0, { t: 'support', kind: 'strafe', x: 30, z: 20 }); // flies along +x from the spawn
  run(g, SUPPORT.strafe.delay + 0.2);
  assert.ok(on.hp < 100, 'unit on the line is hit'); assert.equal(off.hp, 100, 'unit off the line is fine');
}

// Direction: the player picks it. A strafe along z hits units on that line, not the default one.
{
  const g = fresh(); g.players[0].mp = 1000; g.players[1].mp = 1000; g.players[0].spawn = { x: 0, z: 20 };
  const alongX = put(g, 1, 'rifle', 36, 20), alongZ = put(g, 1, 'rifle', 20, 36);
  command(g, 0, { t: 'support', kind: 'strafe', x: 20, z: 20, dir: Math.PI / 2 });
  run(g, SUPPORT.strafe.delay + 0.2);
  assert.ok(alongZ.hp < 100, 'unit on the chosen line is hit');
  assert.equal(alongX.hp, 100, 'unit on the default (from-HQ) line is not');
}

// Dig direction: dir sets the trench line.
{
  const g = fresh(); g.players[0].mp = 1000;
  const r = put(g, 0, 'rifle', 20, 20);
  command(g, 0, { t: 'dig', ids: [r.id], x: 20, z: 20, dir: 0 });
  const ys = new Set(r.dig.cells.map(([c]) => Math.floor(c / g.w)));
  assert.equal(ys.size, 1, 'dir 0 digs along one grid row');
}

// Recon: reveals an enemy hidden behind a building.
{
  const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  put(g, 0, 'rifle', 5, 5); const hidden = put(g, 1, 'rifle', 30, 5);
  run(g, 1);
  assert.ok(!g.players[0].visible.has(hidden.id));
  command(g, 0, { t: 'support', kind: 'recon', x: 30, z: 5 });
  run(g, SUPPORT.recon.delay + 0.5);
  assert.ok(g.players[0].visible.has(hidden.id), 'recon reveals it');
  run(g, SUPPORT.recon.dur + 1);
  assert.ok(!g.players[0].visible.has(hidden.id), 'and it hides again after');
}

// Trench: heavier cover than a crater, and it halves blast damage.
{
  const rows = [...empty]; rows[10] = '.'.repeat(5) + 'T' + '.'.repeat(4) + '+' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const inT = put(g, 1, 'rifle', 11, 21), inC = put(g, 1, 'rifle', 21, 21);
  assert.ok(inTrench(g, inT) && !inTrench(g, inC));
  inT.still = 10; // settled in (a squad that just jumped in gets only crater-level cover)
  const mg = put(g, 0, 'mg', 16, 38); mg.still = 5;
  let tHits = 0, cHits = 0;
  for (let i = 0; i < 4000; i++) {
    const orig = Math.random; let roll = (i % 100) / 100; Math.random = () => roll;
    inT.hp = inC.hp = 100; mg.cooldown = 0; mg.targetId = inT.id;
    step(g); if (inT.hp < 100) tHits++;
    mg.cooldown = 0; mg.targetId = inC.id; mg.retarget = 1;
    step(g); if (inC.hp < 100) cHits++;
    Math.random = orig;
  }
  assert.ok(tHits < cHits * 0.8, `trench is harder to hit than a crater (${tHits} vs ${cHits})`);
}

// Trench mechanics: settling in, facing, hiding, rallying, caving in.
{
  const rows = Array(40).fill('.'.repeat(40)); rows[10] = '.'.repeat(5) + 'TTTT' + '.'.repeat(31);
  const g = fresh(rows), T = CFG.trench;
  const sq = Object.assign(put(g, 1, 'rifle', 13, 21), { cooldown: 1e9, retarget: 1e9 }), front = { x: 13, z: 0 }, flank = { x: 40, z: 21 }, rear = { x: 13, z: 40 };
  sq.still = 0;
  assert.equal(sim.coverMul(g, sq, front), T.fresh, 'a squad that just jumped in gets fresh cover');
  sq.still = T.settle;
  assert.equal(sim.coverMul(g, sq, front), T.dug, 'settled in, it gets the full trench');
  assert.equal(sim.coverMul(g, sq, rear), T.dug, 'a map-drawn trench protects all round');
  // a dug trench facing north (toward z = 0)
  g.trenchFront = new Float32Array(g.w * g.h).fill(NaN);
  for (let x = 5; x < 9; x++) g.trenchFront[10 * g.w + x] = -Math.PI / 2;
  assert.equal(sim.coverMul(g, sq, front), T.dug, 'fire from its front meets the parapet');
  assert.equal(sim.coverMul(g, sq, flank), CFG.coverMul, 'fire along the trench (enfilade) meets plain cover');
  assert.equal(sim.coverMul(g, sq, rear), CFG.coverMul, 'and so does fire from behind');
  // the line patterns face away from the diggers, the ring faces out
  for (const j of sim.entrenchPlan('line', { x: 0, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 10 })) assert.ok(Math.sin(j.front) < -0.99, 'a line faces away from the diggers');
  for (const j of sim.entrenchPlan('ring', { x: 0, z: 0 }, { x: 10, z: 0 }, null)) assert.ok(Math.cos(j.front - Math.atan2(j.z, j.x)) > 0.99, 'a ring faces out');
  // hidden while quiet, seen once it fires
  const spotter = put(g, 0, 'rifle', 13, 46); // 25 m off, beyond trench.hide
  run(g, 0.2);
  assert.ok(!g.players[0].visible.has(sq.id), 'a quiet squad in a trench is not seen at 25 m');
  sq.shotAt = g.tick; run(g, 0.2);
  assert.ok(g.players[0].visible.has(sq.id), 'firing gives it away');
  spotter.hp = 0;
  // suppression wears off faster in a trench
  const open = put(g, 1, 'rifle', 30, 40); sq.supp = open.supp = 60; run(g, 1);
  assert.ok(sq.supp < open.supp - 4, `rallies faster in a trench (${sq.supp} vs ${open.supp})`);
  // shelling caves a trench cell in; a tank driving across crushes it
  const c = 10 * g.w + 5;
  sim.damageCells(g, [], { x: 11, z: 21 }, 0.5, T.hp * 0.6);
  assert.equal(g.chars[c], 'T', 'one hit does not cave it in');
  sim.damageCells(g, [], { x: 11, z: 21 }, 0.5, T.hp * 0.6);
  assert.equal(g.chars[c], '+', 'two do: a crater');
  g.players[0].mp = 1000; const tank = put(g, 0, 'tank', 15, 10); tank.path = [{ x: 15, z: 32 }];
  run(g, 5);
  assert.equal(g.chars[10 * g.w + 7], '+', 'a tank crushes the trench it drives over');
}

// Digging: costs MP, the squad walks over, trench cells appear one by one and are broadcast.
{
  const g = fresh(); g.players[0].mp = 1000;
  const r = put(g, 0, 'rifle', 5, 20); g.players[0].mp = 100;
  command(g, 0, { t: 'dig', ids: [r.id], x: 25, z: 20 });
  assert.ok(Math.abs(g.players[0].mp - (100 - CFG.digCost)) < 1e-9);
  assert.ok(r.dig && r.dig.cells.length === CFG.digCells, 'plans a 4-cell line');
  run(g, 5 + CFG.digTime * CFG.digCells + 1);
  assert.equal(r.dig, null, 'done digging');
  assert.equal(g.cellLog.length, CFG.digCells, 'four trench cells logged');
  assert.ok(snapshotFor(g, 1, [], g.newCells).cells.length === CFG.digCells, 'changes go out in snapshots');
  g.players[0].mp = 1000;
  const mg = put(g, 0, 'mg', 5, 5);
  assert.equal(mg.type, 'mg');
  command(g, 0, { t: 'dig', ids: [mg.id], x: 25, z: 30 });
  assert.equal(mg.dig, null, 'MG teams do not build');
}

// Fortifications: every kind builds its cells; wire slows infantry and tanks flatten it; tank traps stop vehicles.
{
  const at = (g, x, z) => g.chars[Math.floor(z / CELL) * g.w + Math.floor(x / CELL)];
  const build = (kind, type = 'rifle') => {
    const g = fresh(); g.players[0].mp = 5000;
    const u = put(g, 0, 'rifle', 20, 30); u.type = type; // engineers are Classic-only, conscripts USSR-only
    command(g, 0, { t: 'dig', ids: [u.id], kind, x: 20, z: 20, dir: 0 });
    run(g, 40);
    return { g, chars: [...new Set(g.cellLog.map(([, ch]) => ch))].sort().join(''), n: g.cellLog.length, u };
  };
  assert.deepEqual([build('sandbags').chars, build('wire').chars, build('traps').chars], ['#', 'X', 'Y']);
  const nest = build('nest');
  assert.equal(nest.chars, '#T', 'MG nest: a trench pit and sandbags');
  assert.equal(nest.n, 6);
  // the sandbag horseshoe faces away from the builders (they came from below, so the front row is above the pit)
  assert.equal(at(nest.g, 20, 20), 'T'); assert.equal(at(nest.g, 20, 18), '#'); assert.equal(at(nest.g, 20, 22), '.');
  assert.equal(build('wire', 'engineer').chars, 'X', 'engineers build'); assert.equal(build('wire', 'conscript').chars, 'X', 'conscripts build');
  assert.equal(build('nope').n, 0, 'unknown kinds are ignored');
  // wire: infantry crawls through it, a tank flattens it
  {
    const rows = [...empty]; for (let y = 0; y < 20; y++) rows[y] = '.'.repeat(9) + 'XX' + '.'.repeat(9);
    const g = fresh(rows); g.players[0].mp = 5000;
    const r = put(g, 0, 'rifle', 4, 20), t = put(g, 0, 'tank', 4, 30);
    command(g, 0, { t: 'move', orders: [[r.id, 36, 20], [t.id, 36, 30]] });
    const free = 32 / UNITS.rifle.speed;
    run(g, free);
    assert.ok(r.x < 30, `wire slows the squad (at x=${r.x.toFixed(1)} after the open-ground time)`);
    run(g, 10);
    assert.ok(r.x > 34, 'but it gets through');
    assert.equal(at(g, 20, 30), '.', 'the tank flattened the wire it drove over');
  }
  // tank traps: a full line stops a tank's path, but not a squad's
  {
    const rows = [...empty]; rows[10] = 'Y'.repeat(20);
    const g = fresh(rows); g.players[0].mp = 5000;
    const r = put(g, 0, 'rifle', 20, 5), t = put(g, 0, 'tank', 20, 8);
    assert.equal(findPath(g, t, { x: 20, z: 35 }).length, 0, 'no way through for the tank');
    assert.ok(findPath(g, r, { x: 20, z: 35 }).length > 0, 'infantry walks through');
  }
}

// Smoke barrage: clouds appear after the warning and block sight.
{
  const g = fresh(); g.players[0].mp = 1000;
  command(g, 0, { t: 'support', kind: 'smoke', x: 20, z: 20 });
  assert.equal(g.smokes.length, 0);
  run(g, SUPPORT.smoke.delay + 0.2);
  assert.equal(g.smokes.length, SUPPORT.smoke.clouds);
  assert.equal(los(g, { x: 0, z: 20 }, { x: 40, z: 20 }), false, 'smoke screen blocks LOS through its center');
}

// Elevation: a 2-level ridge (5 m) across the middle of an empty map.
const ridge = (lvl, x0 = 9, x1 = 10) => Array.from({ length: 20 }, () => Array.from({ length: 20 }, (_, x) => (x >= x0 && x <= x1 ? lvl : 0)).join(''));
const hilly = (heights) => { const g = createGame({ ...blank(empty), heights }, ['a', 'b'], false); g.units.clear(); g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 })); return g; };
{
  const g = hilly(ridge(2));
  assert.equal(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), false, 'a ridge blocks sight between the valleys');
  // ridge close to the observer: the sight line clears it (right behind a ridge is dead ground, even from a hill)
  const g2 = hilly(Array.from({ length: 20 }, () => '3333' + '0' + '22' + '0'.repeat(13)));
  assert.ok(los(g2, { x: 3, z: 20 }, { x: 35, z: 20 }), 'from higher ground you see over the ridge');
  assert.equal(los(g2, { x: 9, z: 20 }, { x: 35, z: 20 }), false, 'but not from the valley floor');
}
{
  // a 2-level jump is a cliff: the path detours to the gap at the bottom
  // a raised wall (cols 9-10) across rows 0-14, open ground below it
  const heights = Array.from({ length: 20 }, (_, y) => (y < 15 ? '0'.repeat(9) + '22' + '0'.repeat(9) : '0'.repeat(20)));
  const g = hilly(heights);
  const path = findPath(g, { x: 5, z: 5 }, { x: 35, z: 5 });
  assert.ok(path.length && path.some(p => p.z > 15 * CELL), 'cliff: path goes around it');
  // a 1-level step is a slope: straight across
  const g2 = hilly(heights.map(r => r.replace(/2/g, '1')));
  assert.ok(findPath(g2, { x: 5, z: 5 }, { x: 35, z: 5 }).every(p => p.z < 15 * CELL), 'slope: walks straight over');
}
{
  // high ground: same shot, better odds from above
  const hits = (shooterLvl) => {
    const heights = Array.from({ length: 20 }, () => String(shooterLvl).repeat(3) + '0'.repeat(17));
    const g = hilly(heights); g.players[0].mp = g.players[1].mp = 1000;
    const r = put(g, 0, 'rifle', 3, 20), t = put(g, 1, 'rifle', 25, 20);
    let n = 0;
    // total damage, not "was it hit": a 5-man volley almost always lands something, which hides the difference
    for (let i = 0; i < 3000; i++) { t.hp = 100; t.supp = 0; t.cooldown = 99; r.hp = 100; r.supp = 0; r.xp = 0; r.cooldown = 0; r.targetId = t.id; r.retarget = 1; step(g); n += 100 - t.hp; }
    return n;
  };
  const up = hits(2), flat = hits(0);
  assert.ok(up > flat * 1.15, `high ground does more damage (${up} vs ${flat})`);
}

// Depressions: a 2-deep gully hides whoever is in it from the flat ground beside it.
{
  const heights = Array.from({ length: 20 }, () => '0'.repeat(8) + 'bbbb' + '0'.repeat(8));
  const g = hilly(heights);
  assert.equal(los(g, { x: 5, z: 20 }, { x: 21, z: 20 }), false, 'gully floor is out of sight from beside it');
  assert.ok(los(g, { x: 18, z: 20 }, { x: 22, z: 20 }), 'but visible from inside');
  assert.ok(!findPath(g, { x: 5, z: 5 }, { x: 21, z: 5 }).length, 'a 2-deep drop is a cliff');
}

// Rivers, bridges, fords, destruction.
{
  // river down column 10 with a bridge at row 5 and a ford at row 15
  const rows = Array.from({ length: 20 }, (_, y) => '.'.repeat(10) + (y === 5 ? '=' : y === 15 ? 'F' : 'W') + '.'.repeat(9));
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const path = findPath(g, { x: 5, z: 3 }, { x: 35, z: 3 });
  assert.ok(path.length && path.every(p => Math.abs(p.z - 11) < 6 || p.x < 20 || p.x > 22), 'crosses at the bridge');
  assert.ok(los(g, { x: 5, z: 25 }, { x: 35, z: 25 }), 'you can see across water');
  // blow the bridge with artillery: it becomes river, and whoever stood on it is lost
  const onBridge = put(g, 1, 'rifle', 21, 11);
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 21, z: 11, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.equal(g.chars[5 * 20 + 10], 'W', 'bridge destroyed');
  assert.ok(!g.units.has(onBridge.id), 'squad on the bridge went down with it');
  const detour = findPath(g, { x: 5, z: 3 }, { x: 35, z: 3 });
  assert.ok(detour.some(p => p.z > 25), 'now the only way over is the ford');
  assert.ok(g.cellLog.some(([c, ch]) => c === 5 * 20 + 10 && ch === 'W'), 'change is broadcast');
}
{
  // houses collapse into rubble; tanks crush hedges
  const rows = [...empty]; rows[10] = '.'.repeat(8) + 'BB' + '.'.repeat(4) + 'HH' + '.'.repeat(4);
  const g = fresh(rows); g.players[0].mp = 5000;
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 18, z: 21, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.ok(g.chars.slice(10 * 20 + 8, 10 * 20 + 10).every(ch => ch === 'R'), 'house is rubble');
  assert.ok(findPath(g, { x: 17, z: 5 }, { x: 17, z: 35 }).every(p => p.x > 0), 'rubble is walkable');
  const t = put(g, 0, 'tank', 25, 5);
  command(g, 0, { t: 'move', orders: [[t.id, 31, 36]] });
  run(g, 12);
  assert.ok(g.chars.slice(10 * 20 + 14, 10 * 20 + 16).includes('.'), 'tank flattened the hedge');
}

// Attack-move: stops to fight what it meets, then carries on to the destination.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  const r = put(g, 0, 'rifle', 3, 20), foe = put(g, 1, 'rifle', 22, 30); foe.hp = 15;
  command(g, 0, { t: 'amove', orders: [[r.id, 37, 20]] });
  run(g, 2.5);
  assert.ok(r.x < 20, `halted to fight (${r.x.toFixed(1)})`);
  run(g, 20);
  assert.ok(!g.units.has(foe.id), 'enemy killed');
  assert.ok(Math.hypot(r.x - 37, r.z - 20) < 3, 'then reached the destination');
  // a plain move walks straight past
  const g2 = fresh(); g2.players[0].mp = g2.players[1].mp = 5000;
  const r2 = put(g2, 0, 'rifle', 3, 20); put(g2, 1, 'rifle', 22, 30);
  command(g2, 0, { t: 'move', orders: [[r2.id, 37, 20]] });
  run(g2, 9);
  assert.ok(r2.x > 30, 'move ignores enemies');
}

// Garrison: squads enter a house (one per cell), get heavy cover, and are thrown out when it's wrecked.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const a = put(g, 0, 'rifle', 5, 21), b = put(g, 0, 'mg', 5, 17), c = put(g, 0, 'rifle', 5, 25), t = put(g, 0, 'tank', 5, 30);
  command(g, 0, { t: 'garrison', ids: [a.id, b.id, c.id, t.id], x: 19, z: 21 });
  run(g, 8);
  assert.ok(a.garrison >= 0 && b.garrison >= 0 && a.garrison !== b.garrison, 'two squads inside, one per cell');
  assert.equal(c.garrison, -1, 'third squad: house is full');
  assert.equal(t.garrison, -1, 'tanks cannot garrison');
  assert.ok(snapshotFor(g, 0, []).units.find(u => u[0] === a.id)[12] & 32, 'snapshot flags it');
  // heavy cover: the same shots hit less often than in the open
  const foe = put(g, 1, 'mg', 19, 38); foe.still = 5; // the MG inside shoots back: foe's health is reset every step
  let inside = 0, open = 0;
  const scar = CFG.scar.tank; CFG.scar.tank = 0; // the tank's shells would sink the ground under foe between the two counts
  for (let i = 0; i < 1500; i++) { a.hp = 100; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) inside++; }
  command(g, 0, { t: 'move', orders: [[a.id, 19, 30]] });
  assert.equal(a.garrison, -1, 'a move order leaves the building');
  run(g, 3);
  for (let i = 0; i < 1500; i++) { a.hp = 100; a.x = 19; a.z = 30; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) open++; }
  CFG.scar.tank = scar;
  assert.ok(inside < open * 0.8, `garrison is harder to hit (${inside} vs ${open})`);
  // wreck the house with the MG inside
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 19, z: 21, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.ok(!g.units.has(b.id) || (b.garrison === -1 && b.hp < 75), 'squad thrown out and hurt when the house falls');
}

// House types: a block's size on the map makes it a shed, a brick house or a stone building, and a shot-up cell protects less.
{
  const rows = [...empty]; rows[1] = 'B' + '.'.repeat(19);
  for (const y of [4, 5, 6]) rows[y] = 'BBBB' + '.'.repeat(16);
  for (const y of [10, 11, 12, 13]) rows[y] = '.'.repeat(8) + 'BBBBBB' + '.'.repeat(6);
  const g = fresh(rows), shed = 20, brick = 4 * 20, stone = 10 * 20 + 8;
  assert.deepEqual([shed, brick, stone].map(c => g.house[c]), [0, 1, 2], 'type follows the size of the block');
  assert.deepEqual([shed, brick, stone].map(c => g.cellHp[c]), CFG.houses.slice(0, 3).map(h => h.hp), 'each type has its own hit points');
  assert.deepEqual([shed, brick, stone].map(c => sim.garrisonMul(g, c)), CFG.houses.slice(0, 3).map(h => h.mul), 'whole walls give the full protection');
  g.cellHp[brick] /= 2;
  assert.ok(Math.abs(sim.garrisonMul(g, brick) - (CFG.houses[1].mul + CFG.houses[1].worn) / 2) < 1e-6, 'a half-wrecked cell gives half as much');
  const u = put(g, 0, 'rifle', 3, 21); Object.assign(u, { garrison: stone });
  assert.equal(snapshotFor(g, 0, []).units.find(r => r[0] === u.id)[12] >> 20 & 7, 2, 'the snapshot says which type the squad is in');
}

// Map data: named buildings, stone bridges, point kinds and links, triggers.
{
  // a shed named a church is a church: its hit points, and the snapshot says so
  const rows = [...empty]; rows[1] = 'B' + '.'.repeat(19);
  rows[6] = '.'.repeat(5) + 'W'.repeat(10) + '.'.repeat(5); rows[7] = '.'.repeat(5) + 'W'.repeat(4) + '==' + 'W'.repeat(4) + '.'.repeat(5);
  rows[8] = '.'.repeat(5) + 'W'.repeat(10) + '.'.repeat(5);
  const map = { name: 't', ...blank(rows), buildings: [{ x: 0, y: 1, kind: 'church' }, { x: 10, y: 7, kind: 'stone bridge' }] };
  assert.equal(validateMap(map), null);
  const g = createGame(map, ['a', 'b'], false); g.units.clear();
  assert.equal(g.house[20], 3, 'the named type wins over the size');
  assert.equal(g.cellHp[20], CFG.houses[3].hp);
  const u = put(g, 0, 'rifle', 1, 3); u.garrison = 20;
  assert.equal(snapshotFor(g, 0, []).units.find(r => r[0] === u.id)[12] >> 20 & 7, 3, 'a church garrison shows as one');
  // the stone bridge: both cells of its span are tough, a dive bomb's worth doesn't drop it
  const deck = 7 * 20 + 9;
  assert.equal(g.cellHp[deck], CFG.terrainHp['='] * CFG.stoneBridge);
  assert.equal(g.cellHp[deck + 1], CFG.terrainHp['='] * CFG.stoneBridge, 'the whole span, not just the named cell');
  sim.damageCells(g, [], { x: 19, z: 15 }, 1, SUPPORT.dive.terrain);
  assert.equal(g.chars[deck], '=', 'a stone bridge shrugs off one bomb');
  assert.ok(validateMap({ ...map, buildings: [{ x: 3, y: 3, kind: 'church' }] }), 'a type must sit on its house');
  assert.ok(validateMap({ ...map, buildings: [{ x: 0, y: 1, kind: 'castle' }] }), 'only known types');
}
{
  // triggers: at its time the bridge goes with whoever is on it, and everyone hears about it
  const rows = [...empty];
  rows[7] = '.'.repeat(5) + 'W'.repeat(4) + '==' + 'W'.repeat(4) + '.'.repeat(5);
  const map = { name: 't', ...blank(rows), buildings: [{ x: 9, y: 7, kind: 'stone bridge' }], triggers: [{ at: 1, say: 'The bridge is going up!' }, { at: 2, blow: [9, 7, 10, 7], say: 'Bridge down' }] };
  assert.equal(validateMap(map), null);
  assert.ok(validateMap({ ...map, triggers: [{ at: 5 }] }), 'a trigger does something');
  assert.ok(validateMap({ ...map, triggers: [{ at: 5, blow: [9, 7, 30, 7] }] }), 'the box stays on the map');
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { weather: false }); g.units.clear();
  const u = put(g, 0, 'rifle', 19, 15);
  let said = [];
  for (let i = 0; i < 50; i++) { step(g); said.push(...snapshotFor(g, 1, g.shots).shots.filter(s => s.k === 'say').map(s => s.text)); g.shots = []; }
  assert.deepEqual(said, ['The bridge is going up!', 'Bridge down'], 'each message once, to the other side too');
  assert.equal(g.chars[7 * 20 + 9], 'W', 'the bridge is gone');
  assert.equal(g.chars[7 * 20 + 10], 'W', 'all of it');
  assert.ok(!g.units.has(u.id), 'the squad on it went with it');
}
{
  // point kinds and links
  const pts = [{ x: 5, y: 10, kind: 'radio' }, { x: 15, y: 10, kind: 'depot', needs: 0 }];
  const map = { name: 't', ...blank(empty), points: pts };
  assert.equal(validateMap(map), null);
  assert.ok(validateMap({ ...map, points: [{ ...pts[0], needs: 1 }, pts[1]] }), 'points that need each other are refused');
  assert.ok(validateMap({ ...map, points: [{ ...pts[0], kind: 'castle' }, pts[1]] }), 'only known kinds');
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false }); g.units.clear();
  g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 }));
  // locked: a squad on point 2 gets nowhere until its side holds point 1
  const r = put(g, 0, 'rifle', g.points[1].x, g.points[1].z);
  assert.equal(snapshotFor(g, 0, []).points[1][5], 1, 'the snapshot tells the side it is locked');
  run(g, CFG.captureTime + 2);
  assert.equal(g.points[1].owner, -1, 'a locked point is not taken');
  g.points[0].owner = 0;
  run(g, CFG.captureTime + 2);
  assert.equal(g.points[1].owner, 0, 'with the needed point held it is');
  // the radio post (held) speeds support cooldowns
  g.players[0].sup.artillery = g.players[1].sup.artillery = 10;
  run(g, 2);
  assert.ok(Math.abs(g.players[0].sup.artillery - (10 - 2 * CFG.radioCd)) < 0.01 && Math.abs(g.players[1].sup.artillery - 8) < 0.01, 'radio post: faster cooldowns');
  // the depot (held) reinforces like home
  r.hp = UNITS.rifle.hpPer * 2; g.players[0].mp = 1000;
  run(g, CFG.reinforceEvery + 1);
  assert.ok(r.hp > UNITS.rifle.hpPer * 2, 'a squad at its depot is reinforced');
}

// Veterancy: damage dealt earns stars; stars make a squad better.
{
  const g = fresh(); g.players[0].mp = 5000;
  const r = put(g, 0, 'rifle', 5, 5);
  assert.equal(vet(r), 0);
  r.xp = UNITS_COST('rifle') * CFG.vetXp[1];
  assert.equal(vet(r), 2, 'two stars');
  assert.equal(snapshotFor(g, 0, []).units[0][13], 2, 'stars in the snapshot');
}

// Bombing: a stick of bombs flattens the houses along the line and craters the ground.
{
  const rows = [...empty]; rows[10] = '..' + 'BB..'.repeat(4) + '..';
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const houses = () => g.chars.filter(c => c === 'B').length, before = houses();
  const t = put(g, 1, 'tank', 20, 21);
  command(g, 0, { t: 'support', kind: 'bombing', x: 20, z: 21, dir: 0 });
  run(g, SUPPORT.bombing.delay + 3);
  assert.ok(houses() <= before / 4, `most of the row is gone (${before} -> ${houses()})`);
  assert.ok(g.chars.filter(c => c === '+').length >= 10, 'big craters');
  assert.ok(g.height && g.height.filter(l => l < 0).length >= 9 * 3, 'each bomb digs a 3x3 patch');
  assert.ok(g.cellLog.some(e => e[2] < 0), 'the dip is sent to clients');
  // repeated bombing never digs a pit deeper than one level below its neighbours
  for (let i = 0; i < 4; i++) { g.players[0].sup.bombing = 0; command(g, 0, { t: 'support', kind: 'bombing', x: 20, z: 21, dir: 0 }); run(g, SUPPORT.bombing.delay + 3); }
  for (let c = 0; c < g.height.length; c++) if (c % g.w > 0) assert.ok(Math.abs(g.height[c] - g.height[c - 1]) <= 1, 'no cliffs from craters');
  assert.ok(!g.units.has(t.id) || t.hp < 360 * 0.5, 'tank under the bombs is wrecked or badly hurt');
}

// Scarring: a bomb hole is round, and barrage after barrage sinks the ground around where the shells land.
{
  const g = fresh(); g.players[0].mp = 1e6;
  command(g, 0, { t: 'support', kind: 'dive', x: 21, z: 21 }); run(g, SUPPORT.dive.delay + 1);
  const h = (x, y) => g.height[y * 20 + x];
  assert.deepEqual([h(10, 10), h(11, 10), h(11, 11), h(12, 12)], [-2, -1, -1, 0], 'deep in the middle, a ring around it, corners untouched');
  assert.equal(g.chars[10 * 20 + 11], '+', 'the ring is cratered too');
  // a squad fills the hole back in: open ground again, and up as far as the ground beside it allows
  const r = put(g, 0, 'rifle', 17, 21); run(g, 1);
  assert.equal(command(g, 0, { t: 'dig', ids: [r.id], kind: 'fill', x: 21, z: 21, dir: 0 }), undefined, 'fill in is an order');
  run(g, 40);
  assert.deepEqual([g.chars[10 * 20 + 9], g.chars[10 * 20 + 10], h(10, 10)], ['.', '.', 0], 'the middle of the hole is level ground again');
  assert.equal(sim.placementCheck(g, { kind: 'fill', x: 31, z: 31 }).reason, 'blocked', 'nothing to fill on untouched ground');
  // shells land in rows 8-12 here, so rows 7 and 13 only sink from what lands beside them
  const s = fresh(); s.players[0].mp = 1e6;
  for (let i = 0; i < 16; i++) { s.players[0].sup.artillery = 0; command(s, 0, { t: 'support', kind: 'artillery', x: 20, z: 21, dir: 0 }); run(s, SUPPORT.artillery.delay + 5); }
  assert.ok([7, 13].some(y => s.height.slice(y * 20, y * 20 + 20).some(l => l < 0)), 'ground beside the shell holes sinks');
  for (let c = 0; c < s.height.length; c++) if (c % s.w > 0) assert.ok(Math.abs(s.height[c] - s.height[c - 1]) <= 1, 'no cliffs from shelling');
}

// Wrecks: a knocked-out tank stays where it stopped and covers infantry behind it like a live one.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  const t = put(g, 0, 'tank', 20, 21), from = { x: 35, z: 21 };
  t.hp = 0; run(g, 0.5);
  assert.ok(!g.units.has(t.id) && g.wrecks.length === 1, 'the tank is gone, its wreck is not');
  assert.equal(g.chars[10 * 20 + 10], 'Q', 'its cell is a wreck');
  assert.ok(sim.coverBehind(g, { x: 18, z: 21 }, from) > 0.9, 'cover behind the wreck');
  assert.equal(sim.coverBehind(g, { x: 22, z: 21 }, from), 0, 'none in front of it');
  assert.deepEqual(snapshotFor(g, 1, []).wrecks, [[t.id, 'tank', 0, 20, 21, 0]], 'everyone is told where it lies');
  const r = put(g, 0, 'rifle', 30, 30); r.hp = 0; run(g, 0.5);
  assert.equal(g.wrecks.length, 1, 'infantry leave no wreck');
  const cap = CFG.wrecks; CFG.wrecks = 3;
  for (let i = 0; i < 5; i++) { put(g, 0, 'tank', 10 + i * 4, 31).hp = 0; run(g, 0.1); }
  CFG.wrecks = cap;
  assert.deepEqual([g.wrecks.length, g.wrecks[0].x], [3, 18], 'the oldest wrecks are cleared away');
}

// A wreck plugs a causeway for vehicles, not for infantry, until it is blown apart.
{
  const g = fresh(empty.map((row, y) => (y === 10 ? row : 'W'.repeat(20)))); g.players[0].mp = g.players[1].mp = 5000;
  const tank = { x: 5, z: 21, type: 'tank' }, far = { x: 35, z: 21 };
  put(g, 0, 'tank', 20, 21).hp = 0; run(g, 0.5);
  assert.deepEqual(findPath(g, tank, far), [], 'no way past for a tank');
  assert.ok(findPath(g, { x: 5, z: 21 }, far).length, 'infantry climb over');
  command(g, 1, { t: 'support', kind: 'dive', x: 20, z: 21 }); run(g, SUPPORT.dive.delay + 1);
  assert.equal(g.wrecks.length, 0, 'a bomb clears the wreck');
  assert.ok(findPath(g, tank, far).length, 'and the causeway is open again');
}

// Flooding: water creeps from a river down a line of craters, but not uphill and not to a crater that is apart.
{
  const rows = [...empty]; rows[5] = '.....W++.+..........'; rows[8] = '.....W+.............';
  const heights = empty.map((_, y) => '0'.repeat(6) + (y === 8 ? '1' : '0') + '0'.repeat(13));
  const g = createGame({ ...blank(rows), heights }, ['a', 'b'], false), at = (x, y) => g.chars[y * 20 + x], deep = g.wear[5 * 20 + 7];
  run(g, 0.5);
  assert.equal(at(6, 5) + at(7, 5), 'F+', 'the crater on the bank fills first');
  run(g, 1);
  assert.equal(at(7, 5), 'F', 'then the one behind it');
  assert.equal(g.wear[5 * 20 + 7], deep, 'as deep as the crater was');
  assert.equal(at(9, 5), '+', 'a crater apart from the water stays dry');
  assert.equal(at(6, 8), '+', 'a crater above the water stays dry');
}

// Tank shells: ordered to fire at a house, the tank knocks it down.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'B' + '.'.repeat(10);
  const g = fresh(rows); g.players[0].mp = 5000;
  const t = put(g, 0, 'tank', 20, 40);
  command(g, 0, { t: 'fireat', ids: [t.id], x: 19, z: 21 });
  run(g, 20);
  assert.equal(g.chars[10 * 20 + 9], 'R', 'house shelled into rubble');
  assert.equal(t.fireAt, -1, 'tank stops once it is down');
  const r = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'fireat', ids: [r.id], x: 19, z: 21 });
  assert.equal(r.fireAt, -1, 'only tanks take fire-at orders');
}

// Directional cover: a wall on the shooter's side protects, the same wall does nothing against a flank shot.
{
  const rows = [...empty]; rows[10] = '.'.repeat(10) + '#' + '.'.repeat(9); // wall cell at x 20-22, z 20-22
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const r = put(g, 0, 'rifle', 23.5, 21), front = put(g, 1, 'mg', 3, 21), flank = put(g, 1, 'mg', 23.5, 40);
  front.still = flank.still = 5;
  const hits = (shooter, other) => { let n = 0; for (let i = 0; i < 1500; i++) { r.hp = 100; r.supp = 0; r.x = 23.5; r.z = 21; other.cooldown = 99; shooter.hp = 75; other.hp = 75; shooter.cooldown = 0; shooter.targetId = r.id; shooter.retarget = 1; r.cooldown = 99; step(g); if (r.hp < 100) n++; } return n; };
  const fromFront = hits(front, flank), fromFlank = hits(flank, front);
  assert.ok(fromFront < fromFlank * 0.8, `wall protects from the front (${fromFront}) but not the flank (${fromFlank})`);
  assert.equal(snapshotFor(g, 0, []).units.find(u => u[0] === r.id)[10], 3, 'snapshot marks "next to cover"');
}

// Rocket launcher: salvoes a garrisoned squad it can't see directly, and it hurts more than it would in the open.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 5000;
  const sq = put(g, 1, 'rifle', 19, 25);
  command(g, 1, { t: 'garrison', ids: [sq.id], x: 19, z: 21 });
  run(g, 5);
  assert.ok(sq.garrison >= 0, 'squad garrisoned');
  const spotter = put(g, 0, 'rifle', 19, 36), rk = put(g, 0, 'rocket', 19, 3);
  rk.still = 5; spotter.cooldown = 99;
  const orig = Math.random; Math.random = () => 0.01; // rockets land near the aim point (real salvos scatter up to 6 m)
  run(g, 5);
  Math.random = orig;
  assert.ok(sq.hp < 100 || !g.units.has(sq.id), 'salvo hit the garrison');
  assert.ok(g.cellHp[10 * 20 + 9] < 400 || g.chars[10 * 20 + 9] === 'R', 'and damaged the house');
  // manual barrage lands where you click, even unseen, and goes on cooldown
  const g2 = fresh(); g2.players[0].mp = 5000;
  const rk2 = put(g2, 0, 'rocket', 5, 5);
  command(g2, 0, { t: 'ability', ids: [rk2.id], x: 35, z: 35 });
  run(g2, 4);
  assert.ok(rk2.cd > 0 && g2.chars.length, 'barrage fired');
}

// Faction units: only your faction can build them; the Tiger is one at a time.
{
  const g = createGame({ ...blank(empty) }, ['a', 'b', 'c'], false); g.units.clear();
  g.players.forEach(p => (p.mp = 5000));
  command(g, 0, { t: 'buy', unit: 'tiger' }); command(g, 0, { t: 'buy', unit: 'conscript' }); command(g, 0, { t: 'buy', unit: 'ranger' });
  command(g, 1, { t: 'buy', unit: 'tiger' }); command(g, 1, { t: 'buy', unit: 'tiger' });
  command(g, 2, { t: 'buy', unit: 'conscript' });
  const types = (s) => [...g.units.values()].filter(u => u.owner === s).map(u => u.type).sort().join();
  assert.equal(types(0), 'ranger', 'USA: rangers only');
  assert.equal(types(1), 'tiger', 'Germany: one Tiger');
  assert.equal(types(2), 'conscript', 'USSR: conscripts');
}
{
  // UK: Commandos and one Churchill, nobody else gets them; its artillery barrage fires half again as many shells,
  // and the Churchill's front shrugs off 40%
  const g = createGame({ ...blank(empty) }, ['a', 'b', 'c'], false, [0, 1, 2], [3, 0, 1]); g.units.clear();
  g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  command(g, 0, { t: 'buy', unit: 'churchill' }); command(g, 0, { t: 'buy', unit: 'churchill' }); command(g, 0, { t: 'buy', unit: 'commando' }); command(g, 0, { t: 'buy', unit: 'ranger' });
  command(g, 1, { t: 'buy', unit: 'churchill' }); command(g, 1, { t: 'buy', unit: 'commando' });
  const types = (s) => [...g.units.values()].filter(u => u.owner === s).map(u => u.type).sort().join();
  assert.equal(types(0), 'churchill,commando', 'UK: one Churchill and Commandos');
  assert.equal(types(1), '', 'USA: no UK units');
  command(g, 0, { t: 'support', kind: 'artillery', x: 30, z: 30 }); command(g, 1, { t: 'support', kind: 'artillery', x: 30, z: 30 });
  assert.deepEqual(g.strikes.map(s => s.left), [SUPPORT.artillery.shells * 1.5, SUPPORT.artillery.shells], 'UK barrage: 15 shells, others 10');
  const ch = [...g.units.values()].find(u => u.type === 'churchill'); ch.x = 20; ch.z = 20; ch.rot = 0; ch.hp = 1050; g.strikes.length = 0;
  const at = put(g, 1, 'at', 40, 20); at.still = 5; at.auto = false;
  const orig = Math.random; Math.random = () => 0;
  run(g, 0.2);
  Math.random = orig;
  assert.equal(1050 - ch.hp, 120 * 0.6, 'Churchill front armor');
}
{
  // Tiger: the front takes 60%, the rear 200%
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  g.players[1].slot = 1;
  command(g, 1, { t: 'buy', unit: 'tiger' });
  const tg = [...g.units.values()].at(-1); tg.x = 20; tg.z = 20; tg.rot = 0; // facing +x
  const at = put(g, 0, 'at', 40, 20); at.still = 5; at.auto = false; // plain rounds: no autocast AP round
  const orig = Math.random; Math.random = () => 0;
  run(g, 0.2); const front = 900 - tg.hp;
  tg.hp = 900; at.x = 1; at.cooldown = 0; run(g, 0.2); const rear = 900 - tg.hp;
  Math.random = orig;
  assert.equal(front, 120 * 0.7, 'front armor'); assert.equal(rear, 120 * 2, 'rear armor');
}
{
  // Rangers' satchel charge demolishes a house; Ura! shrugs off suppression and sprints
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = createGame(blank(rows), ['a', 'b', 'c'], false); g.units.clear(); g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  command(g, 0, { t: 'buy', unit: 'ranger' }); const rg = [...g.units.values()].at(-1); rg.x = 19; rg.z = 30;
  command(g, 0, { t: 'ability', ids: [rg.id], x: 19, z: 21 });
  run(g, 8);
  assert.ok(g.chars.slice(10 * 20 + 9, 10 * 20 + 11).every(c => c === 'R'), 'satchel demolished the house');
  command(g, 2, { t: 'buy', unit: 'conscript' }); const cs = [...g.units.values()].at(-1); cs.x = 5; cs.z = 35; cs.supp = 95;
  command(g, 2, { t: 'ability', ids: [cs.id] });
  command(g, 2, { t: 'move', orders: [[cs.id, 35, 35]] });
  run(g, 3);
  assert.equal(cs.supp < 50, true, 'suppression cleared');
  assert.ok(cs.x > 5 + 4.6 * 1.5 * 3 * 0.9, `sprinting (${cs.x.toFixed(1)})`);
}

// Teams: 2v2. Allies share vision, never shoot each other, hold each other's points, and win together.
{
  const six = { ...blank(Array(40).fill('.'.repeat(40))), spawns: [0, 1, 2, 3, 4, 5].map(k => ({ x: 20 + Math.round(Math.cos(k) * 15), y: 20 + Math.round(Math.sin(k) * 15) })), points: [{ x: 20, y: 20 }] };
  const g = createGame(six, ['a', 'b', 'c', 'd'], false, [0, 1, 0, 1], [0, 1, 1, 2]); g.units.clear();
  g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  assert.equal(g.players[2].faction, 1, 'factions per player');
  command(g, 2, { t: 'buy', unit: 'tiger' }); assert.equal([...g.units.values()].at(-1)?.type, 'tiger', 'faction comes from the player, not the slot');
  g.units.clear();
  const a = put(g, 0, 'rifle', 40, 40), b = put(g, 2, 'rifle', 44, 40), foe = put(g, 1, 'rifle', 40, 70);
  run(g, 0.2);
  assert.ok(g.players[2].visible.has(foe.id), 'ally sees what I see');
  assert.equal(g.players[0].visible.has(b.id), false, 'allies are not "visible enemies"');
  assert.ok(snapshotFor(g, 0, []).units.some(u => u[0] === b.id), 'but allies are in the snapshot');
  command(g, 0, { t: 'attack', ids: [a.id], target: b.id }); assert.equal(a.attackId, 0, "can't attack an ally");
  foe.x = -500; a.x = b.x = 40; a.z = b.z = 40; // both on the point
  run(g, CFG.captureTime + 1);
  assert.ok(g.points[0].owner === 0 || g.points[0].owner === 2, 'allies capture together');
  g.players[0].vp = CFG.vpToWin * 1.2; g.players[2].vp = CFG.vpToWin; run(g, 0.1);
  assert.equal(g.winVp, CFG.vpToWin * 2, '2v2 plays to twice the VP');
  assert.equal(g.winner, 0, 'team 0 wins on combined VP');
}
{
  // spawn assignment: teammates neighbour, fewer players spread out
  const ring = (a, b) => Math.min(Math.abs(a - b), 6 - Math.abs(a - b));
  assert.deepEqual(spawnSlots(6, [0, 1], false), [0, 3], '1v1 on a 6-spawn map sits opposite');
  const sides = spawnSlots(6, [0, 1, 0, 1, 0, 1], false), [a0, a1, a2] = [sides[0], sides[2], sides[4]];
  assert.ok(ring(a0, a1) + ring(a1, a2) + ring(a0, a2) === 4, '3v3: each team holds three neighbouring spawns');
  const ffa = spawnSlots(6, [0, 1, 2], false);
  assert.ok(ring(ffa[0], ffa[1]) === 2 && ring(ffa[1], ffa[2]) === 2, '3-way FFA spreads evenly');
  for (let i = 0; i < 20; i++) { const s = spawnSlots(6, [0, 0, 1, 1, 2, 2]); assert.equal(new Set(s).size, 6, 'no shared spawns'); }
  // on a real map teammates share a river bank: Pegasus Bridge lists two spawns north of the river, then two south
  const peg = JSON.parse(readFileSync('maps/pegasus-bridge.json', 'utf8'));
  for (let i = 0; i < 20; i++) {
    const g = createGame(peg, ['a', 'b', 'c', 'd'], true, [0, 1, 0, 1]), north = (p) => p.spawn.z < peg.h * CELL / 2;
    assert.equal(north(g.players[0]), north(g.players[2]), '2v2: teammates spawn on the same side of the river');
    assert.notEqual(north(g.players[0]), north(g.players[1]), '2v2: the other team spawns across it');
  }
}

// Army size accepts only named settings and scales each supported mode without changing the balance values.
{
  for (const army of ['toString', '__proto__', ['massive'], { toString: null, valueOf: null }, 'unknown']) {
    let g;
    assert.doesNotThrow(() => { g = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { army }); }, 'malformed army setting does not throw');
    assert.equal(g.players[0].mp, CFG.mpStart, 'malformed army setting uses Standard starting manpower');
    assert.equal(popCap(g), CFG.popCap, 'malformed army setting uses Standard population cap');
  }
  for (const [army, scale] of Object.entries(CFG.armies)) {
    for (const mode of ['conquest', 'classic', 'annihilation', 'assault']) {
      const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
      const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { army, mode, defenderTeam: 1 });
      const start = mode === 'classic' ? CFG.classic.mpStart : mode === 'annihilation' ? CFG.assault.annihilationMp : mode === 'assault' ? CFG.assault.attackerMp : CFG.mpStart;
      assert.equal(g.players[0].mp, start * scale.income, `${mode} ${army} starting manpower`);
      assert.equal(popCap(g), Math.round((mode === 'classic' ? CFG.classic.popCap : CFG.popCap) * scale.pop), `${mode} ${army} population cap`);
      step(g);
      assert.ok(Number.isFinite(g.players[0].mp) && Number.isFinite(g.players[0].inc), `${mode} ${army} finite income`);
    }
  }
}

// Massive move orders reach the whole army, including units beyond the old 50-unit command limit.
{
  const g = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { army: 'massive' });
  g.units.clear(); g.players[0].mp = 100000;
  for (let i = 0; i < popCap(g); i++) put(g, 0, 'rifle', 5, 5);
  const units = [...g.units.values()];
  command(g, 0, { t: 'amove', orders: units.map(u => [u.id, 30, 30]) });
  // one shared spot spreads into a formation (unit behavior), so each unit has its own attack-move end
  assert.equal(units.filter(u => u.amove && u.path.length).length, units.length, 'Massive attack-move reaches every selected unit');
}

// Massive commands apply to every selected ID, including armies inherited above the population cap.
{
  const g = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { army: 'massive' });
  g.units.clear(); g.players.forEach(p => { p.mp = 100000; });
  for (let slot = 0; slot < 2; slot++) for (let i = 0; i < popCap(g); i++) put(g, slot, 'rifle', 5, 5);
  const units = [...g.units.values()];
  for (const u of units) { u.owner = 0; u.amove = { x: 30, z: 30 }; }
  command(g, 0, { t: 'stop', ids: units.map(u => u.id) });
  assert.equal(units.filter(u => u.amove === null).length, units.length, 'Massive stop reaches every selected unit');
  command(g, 0, { t: 'retreat', ids: units.map(u => u.id) });
  assert.equal(units.filter(u => u.retreating).length, units.length, 'Massive retreat reaches every selected unit');
}

// Seeking cover: idle infantry under fire shift to cover within reach; squads with orders and crewed weapons stay put.
{
  const rows = [...empty]; rows[10] = '.....#' + '.'.repeat(14); // a wall cell centered on (11, 21)
  const g = fresh(rows); g.players.forEach(p => (p.mp = 10000));
  g.points.length = 0; // a squad on a capture point never walks out of its circle (unit behavior), and this wall is outside it
  const squad = put(g, 0, 'rifle', 15, 21), mg = put(g, 0, 'mg', 13, 25), mover = put(g, 0, 'rifle', 15, 17);
  put(g, 1, 'rifle', 35, 21);
  command(g, 0, { t: 'move', orders: [[mover.id, 15, 5]] });
  for (let i = 0; i < 80; i++) { mg.hitAt = g.tick; mg.hitFrom = { x: 35, z: 21 }; mover.hitAt = g.tick; mover.hitFrom = { x: 35, z: 21 }; step(g); }
  assert.ok(sim.inCover(g, squad), 'an idle squad under fire moves into nearby cover');
  assert.deepEqual([mg.x, mg.z], [13, 25], 'a crewed weapon under fire keeps its position');
  assert.ok(!sim.inCover(g, mover) && mover.z < 12, 'a squad with a move order keeps following it under fire');
  const far = fresh(); far.players.forEach(p => (p.mp = 10000));
  const open = put(far, 0, 'rifle', 15, 21); put(far, 1, 'rifle', 35, 21);
  run(far, 3);
  assert.deepEqual([open.x, open.z], [15, 21], 'with no cover in reach the squad stays where it is');
}

// Take cover cancels orders to leave a trench even when no better cover exists.
{
  const rows = [...empty]; rows[10] = '.....T' + '.'.repeat(14);
  for (const t of ['move', 'amove']) {
    const g = fresh(rows); g.players[0].mp = 10000;
    const u = put(g, 0, 'rifle', 11, 21);
    command(g, 0, { t, orders: [[u.id, 31, 21]] });
    command(g, 0, { t: 'move', orders: [[u.id, 31, 31]], queue: true });
    assert.equal(command(g, 0, { t: 'cover', ids: [u.id] }), undefined);
    assert.deepEqual(u.path, [], 'Take cover cancels the path out of the trench');
    assert.deepEqual(u.orders, [], 'Take cover clears follow-up orders');
    assert.equal(u.amove, null, 'Take cover cancels attack-move');
    run(g, 3);
    assert.deepEqual([u.x, u.z], [11, 21], 'the covered squad stays put');
  }
}

// House corners: a squad beside a house is covered from shooters on the house's side, and can still shoot back.
{
  const rows = [...empty]; rows[9] = '.....BB' + '.'.repeat(13); rows[8] = rows[9]; // a house over cells x 5-6, y 8-9
  const g = fresh(rows); g.players.forEach(p => (p.mp = 10000));
  // the squad stands just below the house's lower right corner cell (6, 9): cell (7, 10), the house is diagonal to it
  const corner = put(g, 0, 'rifle', 15, 21), open = put(g, 0, 'rifle', 15, 31);
  corner.holdPos = open.holdPos = true; // stay put: this checks the cover rule, not the walking
  const north = put(g, 1, 'rifle', 15, 3), south = put(g, 1, 'rifle', 15, 39);
  for (let i = 0; i < 4; i++) step(g);
  assert.ok(los(g, north, corner), 'the squad at the corner can be seen (and can see) past the house');
  const row = (u) => snapshotFor(g, 0, []).units.find(v => v[0] === u.id);
  assert.equal(row(corner)[10], 3, 'the HUD shows the corner squad as by cover');
  assert.equal(row(open)[10], 0, 'and the squad in the open as not');
  // suppression a single volley adds is scaled by cover, so it measures cover without random hits
  const volley = (shooter, target) => { target.supp = 0; target.hp = 100; shooter.cooldown = 0; shooter.targetId = target.id; shooter.retarget = 1e9; step(g); return target.supp; };
  g.units.delete(south.id);
  const fromHouseSide = volley(north, corner);
  g.units.delete(north.id);
  const flank = put(g, 1, 'rifle', 15, 39); for (let i = 0; i < 4; i++) step(g);
  const fromOpenSide = volley(flank, corner);
  assert.ok(fromHouseSide > 0 && fromOpenSide > 0, 'both volleys were fired');
  assert.ok(fromHouseSide < fromOpenSide * 0.7, 'fire from the house side is blunted; fire from the open side is not');
}

// Stances: hold fire, hold position and auto-retreat are per-unit switches, off for new units.
{
  const g = fresh(); g.players.forEach(p => (p.mp = 10000));
  const a = put(g, 0, 'rifle', 11, 21), b = put(g, 1, 'rifle', 29, 21);
  assert.ok(!a.holdFire && !a.holdPos && !a.autoRetreat, 'a new unit has every switch off');
  assert.equal(command(g, 0, { t: 'stance', ids: [a.id], key: 'toString', on: true }), 'blocked', 'an unknown switch is refused');
  assert.equal(command(g, 0, { t: 'stance', ids: [a.id], key: 'holdFire', on: 1 }), 'blocked', 'on must be true or false');
  assert.equal(command(g, 0, { t: 'stance', ids: [b.id], key: 'holdFire', on: true }), 'needs', 'only your own units');
  assert.equal(command(g, 0, { t: 'stance', ids: [a.id], key: 'holdFire', on: true }), undefined);
  b.holdFire = true; run(g, 4);
  assert.equal(b.hp, UNITS.rifle.models * UNITS.rifle.hpPer, 'a squad holding fire does not shoot an enemy in range');
  for (const cache of [undefined, snapshotCache(g)]) {
    const flags = (slot, u) => snapshotFor(g, slot, [], [], cache).units.find(v => v[0] === u.id)[12];
    assert.ok(flags(0, a) & 2048, 'the owner sees its unit holding fire');
    assert.equal(flags(1, a) & 2048, 0, 'an enemy who sees the unit does not see its stance');
  }
  command(g, 0, { t: 'attack', ids: [a.id], target: b.id }); run(g, 4);
  assert.ok(b.hp < UNITS.rifle.models * UNITS.rifle.hpPer, 'an attack order still shoots while holding fire');
  command(g, 0, { t: 'stance', ids: [a.id], key: 'holdFire', on: false });
  assert.equal(a.holdFire, false, 'the switch turns off again');
}

// Hold fire applies to aircraft, anti-air guns and support interception, with explicit plane attacks allowed.
{
  const big = Array(60).fill('.'.repeat(60)), g = fresh(big); g.players.forEach(p => (p.mp = 10000));
  const plane = put(g, 0, 'attacker', 40, 50), target = put(g, 1, 'rifle', 50, 50);
  target.holdFire = true;
  command(g, 0, { t: 'stance', ids: [plane.id], key: 'holdFire', on: true });
  Object.assign(plane.air, { state: 'station', mission: { kind: 'patrol', x: 50, z: 50 } });
  plane.attackPick = target.id; plane.retarget = 99;
  const ammo = plane.air.ammo;
  run(g, 0.3);
  assert.equal(plane.air.ammo, ammo, 'a Hold fire patrol never fires at ground units');
  assert.equal(command(g, 0, { t: 'attack', ids: [plane.id], target: target.id }), undefined);
  run(g, 1);
  assert.ok(plane.air.ammo < ammo, 'an explicit ground attack overrides the plane stance');

  for (const type of ['mg', 'flak', 'fighter']) {
    const a = fresh(big); a.players.forEach(p => (p.mp = 10000));
    const gun = put(a, 0, type, 50, 50), enemy = put(a, 1, 'attacker', 60, 50);
    command(a, 0, { t: 'stance', ids: [gun.id], key: 'holdFire', on: true });
    enemy.holdFire = true;
    Object.assign(enemy.air, { state: 'station', mission: { kind: 'patrol', x: 60, z: 50 } });
    if (gun.air) Object.assign(gun.air, { state: 'station', mission: { kind: 'patrol', x: 50, z: 50 } });
    gun.still = 3;
    const hp = enemy.hp;
    run(a, 0.3);
    assert.equal(enemy.hp, hp, `${type} holds anti-air fire`);
    if (gun.air) command(a, 0, { t: 'attack', ids: [gun.id], target: enemy.id });
    else command(a, 0, { t: 'stance', ids: [gun.id], key: 'holdFire', on: false });
    run(a, 0.3);
    assert.ok(enemy.hp < hp, `${type} resumes anti-air fire when permitted`);
  }
  const a = fresh(big); a.players.forEach(p => (p.mp = 10000));
  const gun = put(a, 0, 'flak', 50, 50); gun.still = 3; gun.holdFire = true;
  const random = Math.random;
  try {
    Math.random = () => 0;
    command(a, 1, { t: 'support', kind: 'dive', x: 50, z: 50 });
    run(a, SUPPORT.dive.delay + 0.1);
    assert.ok(!a.shots.some(s => s.k === 'shotdown' && s.by === 'flak'), 'Hold fire also prevents support interception');
  } finally { Math.random = random; }
}

// Hold position: no seeking cover. Auto-retreat: a broken squad runs for home; without the switch it stays.
{
  const rows = [...empty]; rows[10] = '.....#' + '.'.repeat(14);
  const g = fresh(rows); g.players.forEach(p => (p.mp = 10000));
  const held = put(g, 0, 'rifle', 15, 21); put(g, 1, 'rifle', 35, 21);
  command(g, 0, { t: 'stance', ids: [held.id], key: 'holdPos', on: true });
  run(g, 4);
  assert.deepEqual([held.x, held.z], [15, 21], 'a squad holding position under fire does not walk to cover');
  const h = fresh(); h.players.forEach(p => (p.mp = 10000));
  const stays = put(h, 0, 'rifle', 21, 21), runs = put(h, 0, 'rifle', 21, 31);
  command(h, 0, { t: 'stance', ids: [runs.id], key: 'autoRetreat', on: true });
  step(h);
  assert.ok(!runs.retreating, 'a healthy squad with auto-retreat stays');
  stays.hp = runs.hp = UNITS.rifle.models * UNITS.rifle.hpPer * 0.3; step(h);
  assert.ok(runs.retreating && !stays.retreating, 'only the squad with auto-retreat on runs when broken');
}

// Vehicles turn their front to the gun shooting them; a group spreads its fire instead of overkilling one squad.
{
  const g = fresh(); g.players.forEach(p => (p.mp = 10000));
  const tank = put(g, 0, 'tank', 21, 21), gun = put(g, 1, 'at', 5, 21);
  tank.hp = 1e5; tank.rot = 0; gun.still = 10; // facing away from the gun
  run(g, 9);
  assert.ok(Math.cos(tank.rot - Math.PI) > 0.95, 'a tank shot in the rear turns its front to the gun');
  const s = fresh(); s.players.forEach(p => (p.mp = 10000));
  const shooters = Array.from({ length: 6 }, (_, i) => put(s, 0, 'rifle', 5, 11 + i * 3));
  const weak = put(s, 1, 'rifle', 25, 19), far = put(s, 1, 'rifle', 27.5, 19);
  weak.hp = 20; weak.holdFire = far.holdFire = true;
  step(s);
  const on = (t) => shooters.filter(u => u.targetId === t.id).length;
  assert.equal(on(weak) + on(far), 6, 'every shooter has a target');
  assert.ok(on(weak) >= 1 && on(far) >= 2, 'once the weak squad is covered, the rest shoot the next one');
}

// Take Cover order: the selected infantry run to cover, crewed weapons included; vehicles and open ground refuse.
{
  const rows = [...empty]; rows[10] = '.....##' + '.'.repeat(13);
  const g = fresh(rows); g.players.forEach(p => (p.mp = 10000));
  const squad = put(g, 0, 'rifle', 17, 21), mg = put(g, 0, 'mg', 17, 23), tank = put(g, 0, 'tank', 30, 30);
  // the squads stand on the capture point at (21, 21) and the wall is outside its circle: they stay on the point
  assert.equal(command(g, 0, { t: 'cover', ids: [squad.id, mg.id] }), 'noCover', 'Take Cover never leaves a capture circle');
  g.points.length = 0;
  squad.amove = { x: 30, z: 21 };
  assert.equal(command(g, 0, { t: 'cover', ids: [tank.id] }), 'needs', 'Take Cover needs infantry');
  assert.equal(command(g, 0, { t: 'cover', ids: [squad.id, mg.id, tank.id] }), undefined, 'Take Cover is accepted');
  assert.equal(squad.amove, null, 'Take Cover replaces the squad\'s orders');
  run(g, 4);
  assert.ok(sim.inCover(g, squad) && sim.inCover(g, mg), 'both squads end up in cover');
  assert.notEqual(Math.floor(squad.x / CELL), Math.floor(mg.x / CELL), 'each squad takes its own cover cell');
  assert.equal(command(g, 0, { t: 'cover', ids: [squad.id] }), undefined, 'a squad already in cover accepts the order and stays');
  const open = put(g, 0, 'rifle', 30, 5);
  assert.equal(command(g, 0, { t: 'cover', ids: [open.id] }), 'noCover', 'no cover within reach is refused');
  open.retreating = true;
  assert.equal(command(g, 0, { t: 'cover', ids: [open.id] }), 'retreating', 'retreating squads do not take cover');
}

// Mass entrenchment: the pattern planner. Segments come middle first and face away from the diggers.
{
  const a = { x: 20, z: 40 }, b = { x: 60, z: 40 }, back = { x: 40, z: 50 }, plan = (p, q = b) => sim.entrenchPlan(p, a, q, back);
  assert.equal(plan('line').length, 5, 'a 40 m line is five trench segments');
  assert.deepEqual([plan('line')[0].x, plan('line')[0].z], [40, 40], 'the middle segment comes first');
  assert.equal(plan('double').length, 10, 'a double line is two rows');
  assert.ok(plan('double').some(j => j.z === 46) && !plan('double').some(j => j.z < 40), 'the second row is behind the first, on the diggers\' side');
  assert.equal(plan('zigzag').length, 6, 'a zigzag packs more segments into the same frontage');
  assert.ok(new Set(plan('zigzag').map(j => j.dir.toFixed(2))).size === 2, 'zigzag segments alternate between two directions');
  assert.equal(plan('ring', { x: 30, z: 40 }).length, 8, 'a 10 m ring is eight segments');
  assert.ok(plan('ring', { x: 30, z: 40 }).every(j => Math.abs(Math.hypot(j.x - 20, j.z - 40) - 10) < 1e-9), 'ring segments sit on the circle');
  assert.ok(plan('arc', { x: 20, z: 20 }).every(j => j.z < 40), 'an arc bows toward the second point');
  assert.deepEqual(plan('strongpoint').map(j => j.kind), ['trench', 'trench', 'trench', 'trench', 'wire', 'wire'], 'a strongpoint is a trench square with wire in front');
  assert.equal(plan('line', a).length, 1, 'a plain click is one segment');
  assert.ok(sim.ENTRENCH_TYPES.every(p => plan(p).length <= 24), 'patterns stay small enough to order at once');
}

// Entrenchment placements reveal nothing about unseen terrain and recheck sight when queued segments start.
{
  const big = Array(80).fill('.'.repeat(80)), g = fresh(big); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 5, 5), order = { t: 'entrench', pattern: 'line', ids: [u.id], x: 120, z: 120, queue: true };
  for (const ch of ['.', 'K', 'W']) {
    g.chars.fill(ch);
    assert.equal(command(g, 0, order), 'notVisible', 'hidden open ground, buildings and water give the same refusal');
    assert.deepEqual(snapshotFor(g, 0, []).works, [], 'unseen terrain never changes the project ghost');
    const place = sim.placementCheck(g, { kind: 'trench', x: 120, z: 120 }, () => false);
    assert.equal(place.reason, 'notVisible');
    assert.deepEqual(place.cells, [], 'unseen placement cells are not exposed');
  }
  g.chars.fill('.');
  assert.equal(sim.placementCheck(g, { kind: 'trench', x: 120, z: 120 }, at => at.x < 120).reason, 'notVisible', 'every cell of a segment needs sight');

  const q = fresh(big); q.players[0].mp = 10000;
  const digger = put(q, 0, 'rifle', 5, 5), scout = put(q, 0, 'rifle', 120, 130);
  assert.equal(command(q, 0, { ...order, ids: [digger.id] }), undefined, 'a scout can provide sight when the pattern is queued');
  q.units.delete(scout.id);
  q.army = { ...q.army, income: 0 };
  const mp = q.players[0].mp;
  step(q);
  assert.ok(!digger.dig, 'a deferred segment cannot start after its sight is lost');
  assert.equal(q.players[0].mp, mp, 'a hidden segment is dropped without payment');
  assert.deepEqual(snapshotFor(q, 0, []).works, [], 'the hidden segment is removed without inspecting its terrain');
}

// Full entrenchment queues cannot allocate unpaid projects or ghosts.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 40, 50);
  for (let i = 0; i < 8; i++) command(g, 0, { t: 'move', orders: [[u.id, 40, 60]], queue: true });
  for (let i = 0; i < 20; i++) {
    assert.equal(command(g, 0, { t: 'entrench', pattern: 'line', ids: [u.id], x: 40, z: 40, queue: true }), 'queueFull');
    assert.deepEqual(snapshotFor(g, 0, []).works, [], 'a refused pattern never appears in snapshots');
    assert.equal(g.projects?.size ?? 0, 0, 'repeated refusals allocate no projects between ticks');
  }
  assert.equal(u.orders.length, 8, 'the full queue is unchanged');
}

// Refused replacement orders leave active entrenchments and paid segments intact.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 40, 50);
  command(g, 0, { t: 'entrench', pattern: 'line', ids: [u.id], x: 20, z: 40, x2: 60, z2: 40 }); step(g);
  const project = u.entrench, dig = u.dig;
  assert.ok(project && dig, 'the squad has started a paid segment');
  for (const order of [
    { t: 'attack', target: 99999 },
    { t: 'move', orders: [[u.id, NaN, 60]] },
    { t: 'garrison', x: 40, z: 40 },
    { t: 'cover' },
  ]) {
    assert.ok(command(g, 0, { ids: [u.id], ...order }), 'the replacement is refused');
    assert.equal(u.entrench, project, 'a refusal keeps the shared project');
    assert.equal(u.dig, dig, 'a refusal keeps the paid segment');
  }
  g.players[0].mp = 0;
  assert.equal(command(g, 0, { t: 'dig', ids: [u.id], x: 40, z: 50 }), 'mp');
  assert.equal(u.entrench, project, 'an unaffordable dig keeps the shared project');
  assert.equal(command(g, 0, { t: 'move', orders: [[u.id, 40, 70]] }), undefined);
  assert.equal(u.entrench, null, 'an accepted replacement detaches the squad');
}

// Mass entrenchment: every selected digger works the pattern, pays per segment and waits when the manpower runs out.
{
  const big = Array(40).fill('.'.repeat(40)), trenches = (g) => g.chars.filter(ch => ch === 'T').length;
  const g = fresh(big); g.players[0].mp = 10000;
  const crew = [put(g, 0, 'rifle', 36, 50), put(g, 0, 'rifle', 40, 50), put(g, 0, 'rifle', 44, 50)], tank = put(g, 0, 'tank', 10, 10);
  const order = { t: 'entrench', pattern: 'line', x: 20, z: 40, x2: 60, z2: 40 };
  assert.equal(command(g, 0, { ...order, ids: [tank.id] }), 'noBuilders', 'a tank cannot entrench');
  assert.equal(command(g, 0, { ...order, ids: crew.map(u => u.id), pattern: 'toString' }), 'blocked', 'an unknown pattern is refused');
  const mp = g.players[0].mp;
  assert.equal(command(g, 0, { ...order, ids: [...crew.map(u => u.id), tank.id] }), undefined, 'the entrench order is accepted');
  assert.equal(g.players[0].mp, mp, 'nothing is paid up front');
  step(g);
  assert.ok(crew.every(u => u.dig), 'every digger takes a segment at once');
  assert.equal(new Set(crew.map(u => `${u.dig.x},${u.dig.z}`)).size, 3, 'each digger takes a different segment');
  assert.ok(crew.some(u => u.dig.x === 40), 'the middle segment is among the first');
  assert.ok(snapshotFor(g, 0, []).units.find(v => v[0] === crew[0].id)[12] & 1024, 'the snapshot flags a digger on a mass entrenchment');
  run(g, 60);
  assert.equal(trenches(g), 20, 'five segments of four cells are dug');
  assert.equal(g.players[0].mp > mp - 150 - 1 && g.players[0].mp < mp + 400, true, 'the line cost five segments');
  assert.ok(crew.every(u => !u.entrench && !u.dig), 'the diggers are free again when the pattern is done');

  const poor = fresh(big); poor.players[0].mp = 10000;
  const two = [put(poor, 0, 'rifle', 38, 50), put(poor, 0, 'rifle', 42, 50)];
  poor.players[0].mp = 45; poor.players[0].inc = 0;
  const income = poor.army.income; poor.army = { ...poor.army, income: 0 };
  assert.equal(command(poor, 0, { ...order, ids: two.map(u => u.id) }), undefined, 'a pattern bigger than the purse is accepted');
  run(poor, 30);
  assert.equal(trenches(poor), 4, 'only the segment that could be paid for is dug');
  assert.ok(two.every(u => u.entrench && !u.dig), 'the diggers wait for manpower');
  poor.players[0].mp = 10000; run(poor, 60);
  assert.equal(trenches(poor), 20, 'the rest is dug once the manpower is there');
  poor.army = { ...poor.army, income };

  const moved = fresh(big); moved.players[0].mp = 10000;
  const one = put(moved, 0, 'rifle', 40, 50);
  command(moved, 0, { ...order, ids: [one.id] }); step(moved);
  command(moved, 0, { t: 'move', orders: [[one.id, 40, 70]] });
  run(moved, 40);
  assert.ok(!one.entrench && one.z > 60, 'a new order takes the digger off the entrenchment for good');
  assert.ok(trenches(moved) < 20, 'and the pattern is left unfinished');

  const fort = fresh(big); fort.players[0].mp = 10000;
  const team = [put(fort, 0, 'rifle', 38, 54), put(fort, 0, 'rifle', 42, 54)];
  assert.equal(command(fort, 0, { t: 'entrench', pattern: 'strongpoint', ids: team.map(u => u.id), x: 40, z: 40, x2: 40, z2: 20 }), undefined);
  run(fort, 90);
  assert.equal(trenches(fort), 12, 'the strongpoint is a closed square of twelve trench cells');
  assert.equal(fort.chars.filter(ch => ch === 'X').length, 10, 'with two runs of wire in front');
  assert.ok(fort.chars.findIndex(ch => ch === 'X') < fort.chars.findIndex(ch => ch === 'T'), 'the wire is on the side the strongpoint faces');
}

// Mass entrenchment is a shared project: its ghost goes to the whole side, more squads can join it, and it can wait
// in a squad's order queue.
{
  const big = Array(40).fill('.'.repeat(40)), trenches = (g) => g.chars.filter(ch => ch === 'T').length;
  const order = { t: 'entrench', pattern: 'line', x: 20, z: 40, x2: 60, z2: 40 };
  const g = createGame(blank(big), ['a', 'b', 'c'], false, [0, 0, 1]); g.units.clear();
  g.players.forEach(p => { p.spawn = { x: -1000, z: -1000 }; p.mp = 10000; });
  const first = put(g, 0, 'rifle', 40, 50), helper = put(g, 0, 'rifle', 44, 50), ally = put(g, 1, 'rifle', 36, 50), foe = put(g, 2, 'rifle', 40, 70);
  for (const u of g.units.values()) u.holdFire = true; // nobody shoots: this is about digging
  command(g, 0, { ...order, ids: [first.id] }); step(g);
  const works = (slot) => snapshotFor(g, slot, []).works;
  assert.equal(works(0).length, 5, 'the owner sees all five segments: four still to dig and the one being dug');
  assert.deepEqual(works(0).map(w => w[5]), ['trench', 'trench', 'trench', 'trench', 'trench'], 'every segment names its kind');
  assert.equal(works(1).length, 5, 'an ally sees the plan too');
  assert.equal(works(2).length, 0, 'an enemy does not');
  const id = works(0)[0][0];
  assert.equal(command(g, 0, { t: 'entrench', ids: [helper.id], join: id + 99 }), 'blocked', 'an unknown project cannot be joined');
  assert.equal(command(g, 2, { t: 'entrench', ids: [foe.id], join: id }), 'blocked', 'an enemy cannot join');
  assert.equal(command(g, 0, { t: 'entrench', ids: [helper.id], join: id }), undefined, 'another squad joins the pattern');
  assert.equal(command(g, 1, { t: 'entrench', ids: [ally.id], join: id }), undefined, 'an ally can help');
  const allyMp = g.players[1].mp; step(g);
  assert.ok(helper.dig && ally.dig, 'the helpers take segments of their own');
  assert.ok(g.players[1].mp < allyMp, 'the ally pays for the segment it digs');
  assert.equal(works(0).length, 5, 'segments stay in the ghost while squads walk to them and dig');
  assert.equal([first, helper, ally].filter(u => u.dig?.kind === 'trench').length, 3, 'three are under way now');
  run(g, 40);
  assert.equal(works(0).length, 0, 'the ghost is gone when the line is dug');
  // the other line fortifications are drawn out the same way: here 15 m of barbed wire, three pieces of five cells
  const cells = (ch) => g.chars.filter(c => c === ch).length;
  assert.equal(command(g, 0, { t: 'entrench', ids: [first.id, helper.id], pattern: 'line', fort: 'wire', x: 25, z: 30, x2: 55, z2: 30 }), undefined, 'a line of wire is ordered');
  assert.deepEqual(works(0).map(w => w[5]), ['wire', 'wire', 'wire'], 'three pieces of wire in the ghost');
  run(g, 40);
  assert.equal(cells('X'), 15, 'the wire runs the whole line');
  assert.equal(command(g, 0, { t: 'entrench', ids: [first.id], pattern: 'line', fort: 'traps', x: 25, z: 26, x2: 33, z2: 26 }), undefined, 'tank traps too');
  run(g, 20); assert.equal(cells('Y'), 4);
  for (const bad of [{ fort: 'bridge' }, { fort: 'nest' }, { fort: 'toString' }, { fort: 'wire', pattern: 'ring' }]) assert.equal(command(g, 0, { t: 'entrench', ids: [first.id], pattern: 'line', x: 25, z: 20, x2: 40, z2: 20, ...bad }), 'blocked', `not as a line: ${JSON.stringify(bad)}`);
  // a single fortification has a ghost too, and it is not something to join
  command(g, 0, { t: 'dig', ids: [first.id], kind: 'wire', x: 40, z: 60, dir: 0 });
  assert.deepEqual(works(0), [[-1, 1, 40, 60, 0, 'wire']], 'one wire shows as a ghost while the squad walks to it');
  assert.equal(works(2).length, 0, 'not to the enemy');
  run(g, 30);
  assert.equal(works(0).length, 0);
  assert.equal(trenches(g), 20, 'together they finish the line');
  assert.equal(g.projects.size, 0, 'a finished project is dropped');

  const q = fresh(big); q.players[0].mp = 10000;
  const u = put(q, 0, 'rifle', 40, 60);
  command(q, 0, { t: 'move', orders: [[u.id, 40, 52]] });
  assert.equal(command(q, 0, { ...order, ids: [u.id], queue: true }), undefined, 'an entrenchment can be queued behind a move');
  assert.ok(!u.entrench && u.orders.length === 1 && u.path.length, 'the squad keeps walking; the pattern waits');
  assert.equal(snapshotFor(q, 0, []).works.length, 5, 'the ghost shows while the order waits');
  assert.equal(command(q, 0, { t: 'move', queue: true, orders: [[u.id, 40, 74]] }), undefined);
  run(q, 2);
  assert.equal(q.projects.size, 1, 'a project somebody is waiting to start is kept');
  run(q, 110);
  assert.equal(trenches(q), 20, 'the queued pattern is dug after the move');
  assert.ok(u.z > 70 && !u.entrench, 'and the move queued behind it runs once the pattern is done');

  const s = fresh(big); s.players[0].mp = 10000;
  const lone = put(s, 0, 'rifle', 40, 50);
  command(s, 0, { ...order, ids: [lone.id] }); step(s);
  command(s, 0, { t: 'stop', ids: [lone.id] }); run(s, 2);
  assert.equal(s.projects.size, 0, 'a pattern nobody works on is dropped');
  assert.deepEqual(snapshotFor(s, 0, []).works, [], 'and its ghost goes with it');
}

// Shared entrenchments hold follow-up orders until the last claimed segment is finished.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const fast = put(g, 0, 'rifle', 36, 41), slow = put(g, 0, 'rifle', 52, 65);
  fast.type = 'engineer';
  command(g, 0, { t: 'entrench', pattern: 'line', ids: [fast.id, slow.id], x: 32, z: 40, x2: 48, z2: 40 });
  command(g, 0, { t: 'move', orders: [[fast.id, 36, 70]], queue: true });
  step(g);
  assert.ok(fast.dig && slow.dig && !fast.entrench.jobs.length, 'all segments are claimed');
  for (let i = 0; fast.dig; i++) { assert.ok(i < 400, 'the engineer finishes'); step(g); }
  assert.ok(slow.dig, 'the distant rifle squad is still digging');
  run(g, 1);
  assert.equal(fast.orders.length, 1, 'the queued move waits for the other digger');
  assert.ok(fast.entrench, 'the engineer still belongs to the unfinished pattern');
  assert.equal(g.projects.size, 1, 'the project survives a sweep while its final segment is active');
  run(g, 35);
  assert.ok(!slow.dig && !fast.entrench && fast.z > 65, 'the move starts after the shared pattern finishes');
  assert.equal(g.projects.size, 0, 'the completed project is collected');
}

// Full shelling queues report queueFull while a mixed selection can still enqueue on an available tank.
{
  const rows = [...empty]; rows[4] = '.'.repeat(14) + 'BB....';
  const g = fresh(rows); g.players[0].mp = 10000;
  const full = put(g, 0, 'tank', 21, 21), free = put(g, 0, 'tank', 21, 31);
  for (let i = 0; i < 8; i++) command(g, 0, { t: 'move', orders: [[full.id, 21, 31]], queue: true });
  const order = { t: 'fireat', ids: [full.id], x: 29, z: 9, queue: true };
  assert.equal(command(g, 0, order), 'queueFull', 'a discarded shelling order is refused');
  assert.equal(full.orders.length, 8, 'the full queue is unchanged');
  assert.equal(command(g, 0, { ...order, ids: [full.id, free.id] }), undefined, 'one successful enqueue accepts the group');
  assert.equal(free.orders.at(-1).t, 'fireat', 'the available tank keeps its shelling order');
}

// Shift-queue: take cover, an aimed ability and shelling a house wait their turn like moves do.
{
  const rows = [...empty]; rows[10] = '.....#' + '.'.repeat(14); rows[4] = '.'.repeat(14) + 'BB....';
  const g = fresh(rows); g.players[0].mp = 10000;
  g.points.length = 0; // the move ends on the capture point and the wall is outside its circle (unit behavior keeps squads on it)
  const squad = put(g, 0, 'rifle', 31, 21), tank = put(g, 0, 'tank', 21, 31);
  command(g, 0, { t: 'move', orders: [[squad.id, 15, 21], [tank.id, 21, 21]] });
  assert.equal(command(g, 0, { t: 'ability', ids: [squad.id], x: 15, z: 15, queue: true }), undefined, 'a grenade can be queued');
  assert.equal(command(g, 0, { t: 'cover', ids: [squad.id], queue: true }), undefined, 'take cover can be queued');
  assert.ok(squad.nade === null && squad.orders.length === 2, 'neither starts while the squad is moving');
  assert.equal(command(g, 0, { t: 'fireat', ids: [tank.id], x: 29, z: 9, queue: true }), undefined, 'shelling a house can be queued');
  assert.ok(tank.fireAt < 0 && tank.orders.length === 1, 'the tank finishes its move first');
  const rowsOf = snapshotFor(g, 0, []).orders;
  assert.deepEqual(rowsOf.find(r => r[0] === squad.id).filter((_, i) => i >= 2 && (i - 2) % 3 === 0), [6, 1], 'queued orders are drawn as a throw, then a move to cover');
  assert.equal(rowsOf.find(r => r[0] === tank.id)[2], 5, 'and as a fire order for the tank');
  run(g, 12);
  assert.ok(sim.inCover(g, squad), 'after the move and the grenade the squad ends up in cover');
  assert.ok(squad.cd > 0, 'the grenade was thrown');
  assert.ok(tank.fireAt >= 0 || g.chars[4 * 20 + 14] !== 'B', 'the tank went on to shell the house');
}

// Assault mode: the defender gets a bunker and fortifications; attackers must destroy it before time runs out.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const mk = () => createGame(map, ['att', 'def'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 1 });
  const g = mk();
  const bunkers = [...g.units.values()].filter(u => u.type === 'bunker');
  assert.equal(bunkers.length, 1, 'one bunker');
  assert.equal(g.points.length, map.points.filter(p => (p.mp ?? 1) > 0).length, 'VP-only points are left out of assault');
  assert.ok(g.points.every(p => p.mp > 0)); assert.equal(bunkers[0].owner, 1, 'owned by the defender');
  assert.equal(vet(bunkers[0]), 0, 'a free unit is not a born veteran');
  assert.ok(g.cellLog.filter(([, ch]) => ch === 'T').length >= 8 && g.cellLog.some(([, ch]) => ch === '#'), 'trenches and walls around the base');
  assert.ok(g.players[0].mp > g.players[1].mp, 'attacker starts richer');
  // can't be ordered, doesn't count as pop
  const b = bunkers[0], bx = b.x;
  command(g, 1, { t: 'move', orders: [[b.id, 5, 5]] }); command(g, 1, { t: 'retreat', ids: [b.id] });
  run(g, 1);
  assert.equal(b.x, bx, 'bunker stays put');
  assert.ok(snapshotFor(g, 0, []).units.some(u => u[0] === b.id), 'attacker always sees the bunker');
  // direct fire barely scratches it; explosives do the work
  const t = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  g.players[0].mp = 5000; command(g, 0, { t: 'buy', unit: 'tank' });
  const tank = [...g.units.values()].at(-1); tank.x = b.x + 20; tank.z = b.z; tank.targetId = b.id; tank.retarget = 99; tank.cooldown = 0;
  const orig = Math.random; Math.random = () => 0;
  const h0 = b.hp; step(g); const shell = h0 - b.hp;
  Math.random = orig;
  assert.ok(shell > 0 && shell <= 45 * 0.25 + 0.01, `tank shell does 25% (${shell})`);
  // off-map support barely touches it: a full bombing run and a barrage dead on target do under 5%
  {
    const g2 = mk(), b2 = [...g2.units.values()].find(u => u.type === 'bunker');
    g2.players[0].mp = 5000;
    command(g2, 0, { t: 'support', kind: 'bombing', x: b2.x, z: b2.z, dir: 0 });
    command(g2, 0, { t: 'support', kind: 'artillery', x: b2.x, z: b2.z, dir: 0 });
    const orig2 = Math.random; Math.random = () => 0.5;
    run(g2, 12);
    Math.random = orig2;
    assert.ok(b2.hp < 3000 && b2.hp > 3000 * 0.95, `support strikes barely scratch the bunker (${Math.round(3000 - b2.hp)} dmg)`);
  }
  // clock runs out: defender wins
  g.mode.timeLeft = 0.01; run(g, 0.1);
  assert.equal(g.winner, 1, 'defender holds');
  // bunker destroyed: attacker wins
  const g2 = mk(), b2 = [...g2.units.values()].find(u => u.type === 'bunker');
  b2.hp = 1; g2.players[0].mp = 5000;
  command(g2, 0, { t: 'support', kind: 'artillery', x: b2.x, z: b2.z, dir: 0 }); // any hit finishes it
  const o3 = Math.random; Math.random = () => 0.5; // shells land on the aim point (random ones could all miss)
  run(g2, SUPPORT.artillery.delay + 5);
  Math.random = o3;
  assert.equal(g2.winner, 0, 'attacker wins when the bunker falls');
}

// Disconnected players: no VP and no manpower while away, then it resumes.
{
  const g = fresh(); g.players[0].mp = 1000;
  put(g, 0, 'rifle', 21, 21);
  run(g, CFG.captureTime + 1);
  g.players[0].away = true;
  const vp = g.players[0].vp, mp = g.players[0].mp;
  run(g, 10);
  assert.equal(g.players[0].vp, vp, 'no VP while away'); assert.equal(g.players[0].mp, mp, 'no manpower while away');
  g.players[0].away = false; run(g, 2);
  assert.ok(g.players[0].vp > vp, 'clock resumes on reconnect');
}

// Hill 112: in assault the defenders always get the hilltop, whatever the shuffle, and attackers can climb it.
{
  const map = JSON.parse(readFileSync('maps/hill-112.json', 'utf8'));
  assert.equal(validateMap(map), null);
  for (let i = 0; i < 10; i++) {
    const g = createGame(map, ['a', 'b', 'd'], true, [0, 0, 1], [0, 1, 2], { mode: 'assault', defenderTeam: 1 });
    const lv = (p) => g.height[Math.floor(p.spawn.z / CELL) * g.w + Math.floor(p.spawn.x / CELL)];
    assert.deepEqual(g.players.map(lv), [0, 0, 4], 'attackers below, defender on top');
    assert.ok(findPath(g, g.players[0].spawn, g.players[2].spawn).length, 'a way up');
  }
  assert.equal(validateMap({ ...map, defend: [0, 1, 2, 3] }), 'defend must list some (not all) spawn numbers');
}

// Classic mode: HQ on the spawn, resource nodes, Engineers build depots, Munitions pay for support, Annihilation.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const mk = () => createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const g = mk(), p = g.players[0], hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  assert.ok(hq && hq.cells.length === 9 && hq.cells.every(c => g.chars[c] === 'K'), 'HQ stamped as a 3x3 building');
  assert.equal(p.mp, CFG.classic.mpStart); assert.equal(p.mun, 0);
  assert.ok(g.nodes.length >= 4, `resource nodes generated (${g.nodes.length})`);
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  assert.ok(eng, 'starts with an Engineer');
  // Engineers exist only in Classic
  const cq = createGame(map, ['a', 'b'], false); cq.players[0].mp = 1000;
  const n0 = cq.units.size; command(cq, 0, { t: 'buy', unit: 'engineer' });
  assert.equal(cq.units.size, n0, 'no Engineers outside Classic');
  // build a depot on the nearest node: pays up front, stamps a site, and income rises once it's finished
  const node = g.nodes.slice().sort((a, b) => Math.hypot(a.x - eng.x, a.z - eng.z) - Math.hypot(b.x - eng.x, b.z - eng.z))[0];
  eng.x = node.x + 4; eng.z = node.z; run(g, 0.3);
  const mpBefore = p.mp;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: node.x, z: node.z });
  const site = g.units.get(node.depot);
  assert.ok(site && site.type === 'depot' && site.built === 0, 'construction site placed');
  assert.equal(p.mp, mpBefore - 60, 'depot paid up front');
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: node.x, z: node.z });
  assert.equal(p.mp, mpBefore - 60, 'no second depot on a taken node');
  run(g, 25);
  assert.equal(site.built, 1, 'finished by one Engineer in about 20s');
  run(g, 0.2);
  const upkeep = [...g.units.values()].filter(u => u.owner === 0 && !u.cells).reduce((a, u) => a + UNITS[u.type].cost * CFG.classic.upkeep, 0);
  assert.ok(Math.abs(p.inc - (CFG.classic.trickle + node.rate - upkeep)) < 1e-9, `finished depot adds its node's rate, minus upkeep (${p.inc})`);
  assert.ok(g.nodes.some(n => n.fuel) && g.nodes.some(n => !n.fuel && n.rate === CFG.classic.homeRate), 'home MP nodes and contested Fuel nodes');
  assert.ok(upkeep > 0 && p.upkeep === upkeep, 'fielded units cost upkeep');
  // supports cost Munitions, not MP
  const mp = p.mp; p.mun = 100;
  command(g, 0, { t: 'support', kind: 'recon', x: 50, z: 50 });
  assert.equal(p.mun, 100 - SUPPORT.recon.mun, 'recon paid in Munitions'); assert.ok(p.mp >= mp, 'no MP spent');
  // holding a point earns Munitions
  const mun0 = p.mun; g.points[0].owner = 0; run(g, 2);
  assert.ok(p.mun > mun0, 'held point earns Munitions');
  // destroying the HQ eliminates the player: their stuff goes too and the other side wins
  const foeHq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  foeHq.hp = 0; run(g, 0.1);
  assert.ok(g.players[1].out, 'player without a Production Building is out');
  assert.ok(![...g.units.values()].some(u => u.owner === 1), 'their units and buildings are gone');
  assert.ok(foeHq.cells.every(c => g.chars[c] === 'R'), 'HQ collapses into rubble');
  assert.equal(g.winner, 0, 'last side standing wins');
}

// Classic production: Barracks and Motor Pool, training queues, rally, cancel, repair, retreat to the nearest building.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer'), hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  p.mp = 5000;
  // HQ trains rifles, but only after the training time; MGs need a Barracks
  command(g, 0, { t: 'buy', unit: 'mg' });
  assert.equal(hq.queue.length, 0, 'no MG without a Barracks');
  const n0 = g.units.size;
  command(g, 0, { t: 'buy', unit: 'rifle' });
  assert.deepEqual(hq.queue, ['rifle'], 'rifle queued at the HQ');
  run(g, 5); assert.equal(g.units.size, n0, 'still training');
  run(g, 11); assert.equal(g.units.size, n0 + 1, 'rifle out after ~15s');
  // Motor Pool needs a finished Barracks
  const spot = (k, dx) => ({ x: hq.x + dx, z: hq.z + 16 });
  eng.x = hq.x; eng.z = hq.z + 10;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'motorpool', ...spot('motorpool', 12) });
  assert.ok(![...g.units.values()].some(u => u.type === 'motorpool'), 'no Motor Pool before a Barracks');
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', ...spot('barracks', -8) });
  const bar = [...g.units.values()].find(u => u.type === 'barracks');
  assert.ok(bar && bar.built === 0 && bar.cells.length === 9, 'Barracks site placed');
  // cancel another site: 75% back and the ground is clear again
  const mp0 = p.mp;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: g.nodes[0].x, z: g.nodes[0].z });
  const dep = [...g.units.values()].find(u => u.type === 'depot' && u.owner === 0);
  if (dep) {
    command(g, 0, { t: 'cancel', id: dep.id });
    assert.equal(g.units.has(dep.id), false, 'site gone'); assert.equal(p.mp, mp0 - 60 + 45, '75% refunded');
    assert.ok(dep.cells.every(c => g.chars[c] === '.'), 'ground cleared'); assert.equal(g.nodes[0].depot, 0, 'node free again');
  }
  command(g, 0, { t: 'assist', ids: [eng.id], id: bar.id });
  run(g, 35);
  assert.equal(bar.built, 1, 'Barracks finished');
  command(g, 0, { t: 'rally', id: bar.id, x: bar.x + 30, z: bar.z });
  command(g, 0, { t: 'buy', unit: 'mg', from: bar.id });
  assert.deepEqual(bar.queue, ['mg'], 'MG queued at the Barracks');
  run(g, 19);
  const mg = [...g.units.values()].find(u => u.owner === 0 && u.type === 'mg');
  assert.ok(mg && Math.hypot(mg.x - bar.x, mg.z - bar.z) < 12, 'MG steps out at the Barracks');
  assert.ok(mg.path.length > 0, 'and heads for the rally point');
  // queue is capped at 5, and queued units count toward the pop cap
  for (let i = 0; i < 7; i++) command(g, 0, { t: 'buy', unit: 'mg', from: bar.id });
  assert.equal(bar.queue.length, 5, 'queue holds 5');
  // Engineers repair a damaged building
  bar.queue = []; bar.hp -= 500; const hp0 = bar.hp;
  command(g, 0, { t: 'assist', ids: [eng.id], id: bar.id });
  run(g, 8);
  assert.ok(bar.hp > hp0, 'repaired');
  // retreat goes to the nearest finished Production Building
  mg.x = bar.x - 30; mg.z = bar.z; command(g, 0, { t: 'retreat', ids: [mg.id] });
  const end = mg.path.at(-1);
  assert.ok(Math.hypot(end.x - bar.x, end.z - bar.z) < Math.hypot(end.x - hq.x, end.z - hq.z), 'retreats to the Barracks, not the HQ');
}

// Classic endgame: Ghosts under fog, the army handed to a teammate, Sudden Death.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  // Ghosts: the enemy HQ is hidden until seen, then remembered where it was
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const foeHq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  run(g, 0.3);
  const sees = () => snapshotFor(g, 0, []).units.some(u => u[0] === foeHq.id), ghost = () => snapshotFor(g, 0, []).ghosts.some(q => q[0] === foeHq.id);
  assert.equal(sees(), false, 'enemy HQ hidden under fog'); assert.equal(ghost(), false, 'and not known yet');
  const scout = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  scout.x = foeHq.x + 12; scout.z = foeHq.z + 12; run(g, 0.3);
  assert.equal(sees(), true, 'seen up close');
  scout.x = 5; scout.z = 5; run(g, 0.3);
  assert.equal(sees(), false, 'out of sight again'); assert.equal(ghost(), true, 'but remembered as a ghost');

  // teams: an eliminated player's army goes to the surviving teammate
  const t = createGame(map, ['a', 'b', 'c'], false, [0, 0, 1], [0, 1, 2], { mode: 'classic' });
  const army = [...t.units.values()].filter(u => u.owner === 1 && !u.cells).map(u => u.id);
  [...t.units.values()].find(u => u.owner === 1 && u.type === 'hq').hp = 0;
  run(t, 0.1);
  assert.ok(t.players[1].out, 'player 1 out'); assert.equal(t.winner, null, 'team still alive');
  assert.ok(army.every(id => t.units.get(id)?.owner === 0), 'their squads now answer to the teammate');

  // Sudden Death: no training or building, Production Buildings crumble, last one standing wins
  const sd = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq0 = [...sd.units.values()].find(u => u.owner === 0 && u.type === 'hq'), hq1 = [...sd.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  sd.players[0].mp = 1000; sd.mode.timeLeft = 0.05; run(sd, 0.2);
  assert.ok(sd.mode.suddenDeath, 'sudden death started');
  command(sd, 0, { t: 'buy', unit: 'rifle' }); assert.equal(hq0.queue.length, 0, 'no training');
  const h = hq0.hp; run(sd, 10);
  assert.ok(Math.abs(h - hq0.hp - UNITS.hq.hpPer * CFG.classic.decay * 10) < 5, `decays 1%/s (${h - hq0.hp})`);
  hq1.hp = hq0.hp - 50; run(sd, 100);
  assert.equal(sd.winner, 0, 'the sturdier base outlasts the other');
}

// Classic: unit abilities cost Munitions (and still have cooldowns); other modes stay free.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const rifle = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  p.mun = 0;
  command(g, 0, { t: 'ability', ids: [rifle.id], x: rifle.x + 5, z: rifle.z });
  assert.equal(rifle.nade, null, 'no grenade without Munitions');
  p.mun = 20;
  command(g, 0, { t: 'ability', ids: [rifle.id], x: rifle.x + 5, z: rifle.z });
  run(g, 0.2);
  assert.equal(p.mun < 20 - 14, true, `grenade paid when thrown (${p.mun})`); assert.ok(rifle.cd > 0, 'and on cooldown');
  const c = createGame(map, ['a', 'b'], false), r2 = [...c.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  command(c, 0, { t: 'ability', ids: [r2.id], x: r2.x + 5, z: r2.z }); run(c, 0.2);
  assert.ok(r2.cd > 0, 'free in Conquest');
}

// Autocast (Warcraft 3 style): right-click an ability and the unit uses it by itself. On by default where abilities are
// free, off where they cost Munitions. It goes through the ability command (cost, cooldown) and sees only what its side sees.
{
  const cover = [...empty]; cover[10] = '.'.repeat(10) + '+' + '.'.repeat(9); // sandbags at x 20-22, z 20-22
  const setup = (rows) => {
    const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
    const r = put(g, 0, 'rifle', 10, 21), e = put(g, 1, 'rifle', 21, 21); // 11 m apart: grenade range is 18
    e.auto = false;
    return { g, r, e };
  };
  // grenades r throws in secs (both rifle squads kept at full strength so the duel never ends first)
  const throws = (g, r, secs) => {
    let n = 0;
    for (let i = 0; i < secs * 20; i++) { const cd = r.cd; for (const u of g.units.values()) u.hp = 100; step(g); if (r.cd > cd + 1) n++; }
    return n;
  };

  // the command: your own units that have an ability, and a real on/off
  {
    const { g, r, e } = setup(empty), flak = put(g, 0, 'flak', 4, 4);
    assert.equal(r.auto, true, 'free abilities autocast by default');
    assert.equal(flak.auto, false, 'nothing to autocast without an ability');
    assert.equal(command(g, 0, { t: 'autocast', ids: [r.id], on: 'yes' }), 'blocked', 'on must be true or false');
    assert.equal(command(g, 0, { t: 'autocast', ids: [e.id, flak.id], on: true }), 'needs', 'enemy units and units without an ability are refused');
    assert.equal(e.auto, false, "an enemy's autocast is not yours to change");
    assert.equal(command(g, 0, { t: 'autocast', ids: [r.id, flak.id], on: false }), undefined);
    assert.equal(r.auto, false, 'autocast turned off');
  }

  // a grenade at the squad in cover, once per cooldown; nothing while autocast is off
  {
    const { g, r, e } = setup(cover);
    let thrown = null;
    for (let i = 0; i < 20 && !thrown; i++) { step(g); thrown = g.nades.find(n => n.owner === 0); }
    assert.ok(thrown && Math.hypot(thrown.x - e.x, thrown.z - e.z) < 2, 'autocast grenade thrown at the squad in cover');
    assert.ok(throws(g, r, 10) === 0 && r.cd > 0, 'one throw per cooldown');
    r.cd = 0; r.auto = false;
    assert.equal(throws(g, r, 3), 0, 'autocast off: no grenade');
    r.auto = true;
    assert.equal(throws(g, r, 1), 1, 'autocast on again: the cooldown was all that held it');
    r.cd = 0; r.holdFire = true;
    assert.equal(throws(g, r, 3), 0, 'holding fire: no autocast grenade either');
  }

  // not at a squad its side cannot see (a house in between)
  {
    const rows = cover.map((row, z) => (z >= 8 && z <= 12 ? row.slice(0, 7) + 'B' + row.slice(8) : row));
    const { g, r, e } = setup(rows);
    run(g, 3);
    assert.equal(g.players[0].visible.has(e.id), false, 'the house hides the squad');
    assert.ok(r.cd <= 0 && !r.nade, 'no grenade at what it cannot see');
  }

  // a retreating squad never autocasts, and a player's own ability order is never replaced
  {
    const { g, r } = setup(cover);
    g.players[0].spawn = { x: 3, z: 39 };
    command(g, 0, { t: 'retreat', ids: [r.id] });
    assert.equal(throws(g, r, 1.5), 0, 'no autocast while retreating');
    assert.ok(r.retreating, 'still on the way home');
    const o = setup(cover);
    command(o.g, 0, { t: 'ability', ids: [o.r.id], x: 35, z: 39 }); // 31 m: out of range, so the squad walks first
    run(o.g, 1);
    assert.ok(o.r.nade?.x === 35 && !o.r.nade.auto, "the player's grenade order stands");
  }

  // Classic: off by default, and an autocast grenade waits for Munitions, then pays for itself
  {
    const g = createGame(blank(cover), ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
    const of = (slot) => [...g.units.values()].find(u => u.owner === slot && u.type === 'rifle');
    const r = of(0), e = of(1);
    for (const u of [...g.units.values()]) if (u.type === 'engineer') g.units.delete(u.id);
    assert.equal(r.auto, false, 'abilities that cost Munitions start with autocast off');
    r.x = 10; r.z = 21; e.x = 21; e.z = 21; r.auto = true; p.mun = 0;
    run(g, 2);
    assert.ok(r.cd <= 0 && !r.nade, 'no Munitions, no grenade');
    p.mun = 20;
    run(g, 1);
    assert.ok(r.cd > 25 && Math.abs(p.mun - 5) < 1, `autocast grenade paid 15 Munitions (${p.mun})`);
  }

  // the snapshot tells only the owner (AUTO_FLAG, 16384), cached or not
  {
    const { g, r } = setup(empty);
    run(g, 0.5);
    const flagOf = (s) => s.units.find(row => row[0] === r.id)[12] & sim.AUTO_FLAG;
    const cache = snapshotCache(g);
    assert.ok(flagOf(snapshotFor(g, 0, [])) && flagOf(snapshotFor(g, 0, [], [], cache)), 'the owner sees autocast on');
    assert.equal(flagOf(snapshotFor(g, 1, [])), 0, 'the enemy does not');
    assert.equal(flagOf(snapshotFor(g, 1, [], [], snapshotCache(g))), 0, 'the enemy does not (cached)');
  }

  // the client remembers the choice per unit type (Classic apart) and gives it to new units once
  {
    const sent = [], store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const ac = createAutocast({ storage, send: (c) => sent.push(c) }), A = sim.AUTO_FLAG;
    const row = (id, type, owner, flags) => { const x = Array(15).fill(0); x[0] = id; x[1] = type; x[2] = owner; x[12] = flags; return x; };
    assert.equal(ac.toggle('rifle', [{ id: 1, flags: A }, { id: 2, flags: 0 }], false), true, 'mixed selection: turn it on for all');
    assert.equal(ac.toggle('rifle', [{ id: 1, flags: A }, { id: 2, flags: A }], false), false, 'all on: turn it off');
    assert.deepEqual(sent.at(-1), { t: 'autocast', ids: [1, 2], on: false });
    sent.length = 0;
    ac.adopt([row(5, 'rifle', 0, A), row(6, 'rifle', 0, 0), row(7, 'mg', 0, A), row(8, 'rifle', 1, A)], 0, false);
    assert.deepEqual(sent, [{ t: 'autocast', ids: [5], on: false }], 'a new rifle squad takes the remembered choice; other types and enemies are left alone');
    ac.adopt([row(5, 'rifle', 0, A)], 0, false);
    assert.equal(sent.length, 1, 'once per unit, so turning one back on by hand sticks');
    const again = createAutocast({ storage, send: (c) => sent.push(c) });
    again.adopt([row(9, 'rifle', 0, A)], 0, true);
    assert.equal(sent.length, 1, 'Classic keeps its own memory');
    again.adopt([row(10, 'rifle', 0, A)], 0, false);
    assert.deepEqual(sent.at(-1), { t: 'autocast', ids: [10], on: false }, 'remembered across matches');
  }
}

// Autocast, the other abilities: each has its own reason to fire (the cooldown starting is the sign), judged from what the
// unit's side can see. Enemies here have autocast off and never shoot, so only the unit under test acts.
{
  const wide = Array(20).fill('.'.repeat(60));
  const rich = (g) => { g.players.forEach(p => (p.mp = 5000)); return g; };
  const setup = (n = 2) => rich(fresh(wide, n));
  const within = (g, secs, done) => { for (let i = 0; i < secs * 20; i++) { step(g); if (done()) return true; } return false; };
  const foe = (g, type, x, z) => { const u = put(g, 1, type, x, z); u.auto = false; u.cooldown = 1e9; return u; };
  const crowd = (g, xs) => xs.forEach(x => foe(g, 'rifle', x, 21 + (x % 2)));

  // Suppressive Fire: for a squad advancing on the MG, not one walking away
  {
    const g = setup(), mg = put(g, 0, 'mg', 20, 21), e = foe(g, 'rifle', 45, 21); mg.still = 5; // set up
    command(g, 1, { t: 'move', orders: [[e.id, 22, 21]] });
    assert.ok(within(g, 2, () => mg.cd > 0 && mg.buff > 0), 'the MG suppresses a squad coming at it');
    const h = setup(), mg2 = put(h, 0, 'mg', 20, 21), away = foe(h, 'rifle', 40, 21); mg2.still = 5;
    command(h, 1, { t: 'move', orders: [[away.id, 58, 21]] });
    assert.ok(!within(h, 3, () => mg2.cd > 0), 'no Suppressive Fire at a squad walking away');
  }
  // AP round: for a vehicle it is shooting at, not for infantry
  {
    const g = setup(), at = put(g, 0, 'at', 20, 21); at.still = 5; foe(g, 'tank', 50, 21);
    assert.ok(within(g, 2, () => at.cd > 0), 'the AT gun loads AP against a tank');
    const h = setup(), at2 = put(h, 0, 'at', 20, 21); at2.still = 5; foe(h, 'rifle', 40, 21);
    assert.ok(!within(h, 2, () => at2.cd > 0), 'no AP round against infantry');
  }
  // smoke: only a badly hurt tank that was just hit by anti-tank fire
  {
    const smokeAfter = (hp, hit) => {
      const g = setup(), tk = put(g, 0, 'tank', 20, 21); tk.hp = hp; if (hit) tk.atHit = g.tick;
      return within(g, 1, () => g.smokes.length > 0 && tk.cd > 0);
    };
    assert.equal(smokeAfter(100, true), true, 'a hurt tank under anti-tank fire pops smoke');
    assert.equal(smokeAfter(300, true), false, 'a healthy tank does not');
    assert.equal(smokeAfter(100, false), false, 'a hurt tank nobody is hitting does not');
  }
  // barrage: a crowd it can see, never over its own troops, never at what its side cannot see
  {
    const spotter = (g, x) => { put(g, 0, 'rifle', x, 21).auto = false; };
    for (const type of ['rocket', 'mortar']) {
      const g = setup(), gun = put(g, 0, type, 20, 21); gun.still = 5; crowd(g, [46, 47, 48]); spotter(g, 30);
      assert.ok(within(g, 2, () => gun.cd > 0), `${type}: a crowd of three it can see gets a barrage`);
    }
    const near = setup(), r1 = put(near, 0, 'rocket', 20, 21); crowd(near, [50, 51, 52]); spotter(near, 45);
    assert.ok(!within(near, 2, () => r1.cd > 0), 'a friendly squad inside the blast stops it');
    const hidden = setup(), r2 = put(hidden, 0, 'rocket', 20, 21); crowd(hidden, [55, 56, 57]);
    assert.ok(!within(hidden, 2, () => r2.cd > 0) && hidden.players[0].visible.size === 0, 'a crowd its side cannot see is left alone');
    const two = setup(), r3 = put(two, 0, 'rocket', 20, 21); crowd(two, [50, 51]); spotter(two, 30);
    assert.ok(!within(two, 2, () => r3.cd > 0), 'two in the open are not worth a barrage');
  }
  // Ura!: a pinned squad on the move, not one standing still
  {
    const g = setup(3), cs = put(g, 2, 'conscript', 20, 21); cs.supp = 70;
    command(g, 2, { t: 'move', orders: [[cs.id, 50, 21]] });
    assert.ok(within(g, 1, () => cs.sprint > 0), 'pinned conscripts on the move shout Ura!');
    const h = setup(3), idle = put(h, 2, 'conscript', 20, 21);
    assert.ok(!within(h, 1.5, () => { idle.supp = 70; return idle.sprint > 0; }), 'pinned but standing still: no Ura!');
  }
  // satchel: Rangers ordered to attack a squad in a house walk up and plant it once within 20 m (they stop to shoot at 26 m)
  {
    const rows = wide.map((row, z) => (z === 9 || z === 10 ? row.slice(0, 30) + 'BB' + row.slice(32) : row));
    const planted = (auto) => {
      const g = rich(fresh(rows)), e = foe(g, 'rifle', 75, 20);
      command(g, 1, { t: 'garrison', ids: [e.id], x: 63, z: 20 });
      assert.ok(within(g, 20, () => e.garrison >= 0), 'the squad took the house');
      const rg = put(g, 0, 'ranger', 82, 20); rg.auto = auto;
      run(g, 0.5);
      assert.equal(command(g, 0, { t: 'attack', ids: [rg.id], target: e.id }), undefined);
      return within(g, 10, () => rg.cd > 0);
    };
    assert.equal(planted(true), true, 'the Rangers plant a satchel on the house they were told to attack');
    assert.equal(planted(false), false, 'with autocast off they only shoot');
  }
}

// Fuel (Classic): contested depots and the HQ pay Fuel; vehicles need it. New units: camouflaged sniper, mortar barrage.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  run(g, 5);
  assert.ok(Math.abs(p.fuel - CFG.classic.hqFuel * 5) < 0.05, `HQ trickles Fuel (${p.fuel})`);
  // a Motor Pool that can train vehicles
  const c = g.units.size;
  const mp = { id: 0 }; p.mp = 5000;
  const bar = [...g.units.values()].find(u => u.type === 'hq' && u.owner === 0);
  for (const t of ['barracks', 'motorpool']) {
    const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
    eng.x = hq.x; eng.z = hq.z + 10;
    command(g, 0, { t: 'build', ids: [eng.id], kind: t, x: hq.x + (t === 'barracks' ? -8 : 8), z: hq.z + 16 });
    const b = [...g.units.values()].find(u => u.type === t && u.owner === 0);
    assert.ok(b, t + ' placed'); b.built = 1; b.hp = UNITS[t].hpPer;
  }
  const pool = [...g.units.values()].find(u => u.type === 'motorpool' && u.owner === 0);
  p.fuel = 10;
  command(g, 0, { t: 'buy', unit: 'tank', from: pool.id });
  assert.equal(pool.queue.length, 0, 'no tank without Fuel');
  p.fuel = 100; const mp0 = p.mp;
  command(g, 0, { t: 'buy', unit: 'tank', from: pool.id });
  assert.deepEqual(pool.queue, ['tank'], 'tank queued'); assert.equal(p.fuel, 100 - UNITS.tank.fuel); assert.equal(p.mp, mp0 - UNITS.tank.classicCost, 'cheaper in MP');
  // a depot on a contested node pays Fuel, not MP
  const fn = g.nodes.find(n => n.fuel), eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  // stand next to the node on open ground (village nodes have houses around them)
  const open = [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]].map(([dx, dz]) => ({ x: fn.x + dx, z: fn.z + dz })).find(q => g.chars[Math.floor(q.z / CELL) * g.w + Math.floor(q.x / CELL)] === '.');
  eng.x = open.x; eng.z = open.z; run(g, 0.3);
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: fn.x, z: fn.z });
  const dep = g.units.get(fn.depot); dep.built = 1; run(g, 0.2);
  assert.ok(Math.abs(p.fuelInc - (CFG.classic.hqFuel + CFG.classic.contestedFuel)) < 1e-9, `contested depot pays Fuel (${p.fuelInc})`);
}
{
  // sniper: seen while it shoots or moves, hidden from afar once it keeps still and quiet
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const sn = put(g, 0, 'sniper', 10, 10), spot = put(g, 1, 'rifle', 40, 10);
  spot.retarget = 999; spot.targetId = 0; spot.attackId = 0;
  sn.cooldown = 1e9; // holds fire (firing gives it away, checked below)
  run(g, 0.3);
  const seen = () => g.players[1].visible.has(sn.id);
  assert.equal(seen(), true, 'a fresh sniper is visible');
  run(g, 4);
  assert.equal(seen(), false, 'still and quiet: camouflaged at 30 m');
  spot.x = 18; run(g, 0.3);
  assert.equal(seen(), true, 'but seen up close');
  spot.x = 40; run(g, 0.3); assert.equal(seen(), false, 'hidden again from afar');
  sn.cooldown = 0; run(g, 0.5);
  assert.equal(seen(), true, 'firing gives it away');
  // mortar barrage: 4 shells on the spot, no line of sight needed
  const m = fresh(); m.players[0].mp = 1000;
  const mo = put(m, 0, 'mortar', 10, 10);
  command(m, 0, { t: 'ability', ids: [mo.id], x: 50, z: 10 });
  run(m, 0.1);
  assert.equal(m.salvos[0]?.left, 4, 'mortar barrage is 4 shells');
  // the new units are in Conquest too
  for (const t of ['mortar', 'sniper', 'armoredcar', 'medium', 'tankdestroyer', 'howitzer', 'flamer', 'bomber']) { const q = fresh(); q.players[0].mp = 1000; command(q, 0, { t: 'buy', unit: t }); assert.equal(q.units.size, 1, t + ' buyable in Conquest'); }
  // howitzer barrage: 4 shells, beyond a mortar's reach
  const wide = Array(60).fill('.'.repeat(60)); // 120 m: the default test map is too small for a howitzer
  const hz = fresh(wide); hz.players[0].mp = 1000;
  const hw = put(hz, 0, 'howitzer', 10, 10);
  command(hz, 0, { t: 'ability', ids: [hw.id], x: 90, z: 10 });
  run(hz, 0.1);
  assert.equal(hz.salvos[0]?.left, 4, 'howitzer barrage lands 80 m out');
  assert.ok(Math.abs(hz.salvos[0].spread - (3 + 5 * 50 / 65)) < 0.2, `shells scatter more far out (${hz.salvos[0].spread})`);
  const hn = fresh(wide); hn.players[0].mp = 1000;
  const hw2 = put(hn, 0, 'howitzer', 10, 10);
  command(hn, 0, { t: 'ability', ids: [hw2.id], x: 42, z: 10 });
  run(hn, 0.1);
  assert.ok(hn.salvos[0].spread < 3.2, 'and land tight close in');
  // area fire: salvo weapons shell open ground (seen or not) and keep at it; direct-fire guns can't
  const af = fresh(wide); af.players[0].mp = 5000;
  const ah = put(af, 0, 'howitzer', 10, 10), at2 = put(af, 0, 'tank', 10, 20);
  assert.equal(command(af, 0, { t: 'fireat', ids: [ah.id], x: 80, z: 80 }), undefined, 'a howitzer shells open ground');
  assert.notEqual(command(af, 0, { t: 'fireat', ids: [at2.id], x: 80, z: 80 }), undefined, 'a tank only shells a structure');
  let shells = 0;
  for (let i = 0; i < 40 * 20; i++) { step(af); shells += af.shots.filter(s => s.k === 'salvo' && s.f === ah.id).length; af.shots = []; }
  assert.ok(shells >= 2 && ah.fireAt >= 0, `the howitzer keeps shelling the spot (${shells} shells)`);
  const ab = fresh(wide); ab.players[0].mp = 5000;
  const bm = put(ab, 0, 'bomber', 10, 10);
  assert.equal(command(ab, 0, { t: 'fireat', ids: [bm.id], x: 90, z: 90 }), undefined, 'a bomber takes an area order');
  let sticks = 0;
  for (let i = 0; i < 60 * 20 && sticks < 2; i++) { step(ab); sticks += ab.shots.filter(s => s.k === 'salvo' && s.f === bm.id && Math.hypot(s.x - 91, s.z - 91) < 3).length; ab.shots = []; }
  assert.equal(sticks, 2, 'the bomber drops both sticks on the spot');
}

// Classic resources on every shipped map: each player gets an HQ and 2 MP nodes close to home, and Fuel nodes sit
// halfway between enemies (nobody gets a private one next to their HQ).
for (const name of ['default', 'river-towns', 'six-fronts', 'hill-112']) {
  const map = JSON.parse(readFileSync(`maps/${name}.json`, 'utf8'));
  for (const n of [2, map.spawns.length]) {
    const names = Array.from({ length: n }, (_, i) => 'p' + i), g = createGame(map, names, false, names.map((_, i) => i), names.map((_, i) => i % 3), { mode: 'classic' });
    assert.ok(g.nodes.filter(nd => nd.fuel).length >= 2, `${name} ${n}p has Fuel nodes`);
    for (const p of g.players) {
      assert.ok([...g.units.values()].some(u => u.owner === p.slot && u.type === 'hq'), `${name} ${n}p: player ${p.slot} has an HQ`);
      const d = (nd) => Math.hypot(nd.x - p.spawn.x, nd.z - p.spawn.z);
      assert.ok(g.nodes.filter(nd => !nd.fuel && d(nd) < 40).length >= 2, `${name} ${n}p: player ${p.slot} has 2 MP nodes near home`);
      assert.ok(g.nodes.filter(nd => nd.fuel).every(nd => d(nd) > 20), `${name} ${n}p: no Fuel node in player ${p.slot}'s backyard`);
    }
  }
}

// XL assault maps: 6 spawns (3 defend), and a map can set its own assault clock.
for (const name of ['pegasus-bridge-xl', 'hill-112-xl', 'seawall-xl', 'monte-cassino-xl']) {
  const map = JSON.parse(readFileSync(`maps/${name}.json`, 'utf8'));
  assert.equal(validateMap(map), null, name + ' is valid');
  assert.equal(map.spawns.length, 6, name + ' has 6 spawns'); assert.deepEqual(map.defend, [0, 1, 2]);
  const g = createGame(map, ['a', 'b', 'c', 'd', 'e', 'f'], false, [0, 0, 0, 1, 1, 1], [0, 1, 2, 0, 1, 2], { mode: 'assault', defenderTeam: 0 });
  assert.equal(g.mode.timeLeft, map.assaultTime ?? CFG.assault.time, name + ' uses its own clock');
  assert.equal([...g.units.values()].filter(u => u.type === 'bunker').length, 3, name + ': a bunker per defender');
}
assert.equal(validateMap({ ...JSON.parse(readFileSync('maps/default.json', 'utf8')), assaultTime: 5 }), 'assaultTime must be 300-3600 seconds');
// Assault-only spawns: a spawn inside the defenders' fortress is skipped by every other mode
{
  const m = { ...JSON.parse(readFileSync('maps/default.json', 'utf8')) };
  m.spawns = [{ ...m.spawns[0], assault: true }, ...m.spawns.slice(1), { x: 40, y: 40 }];
  m.spawns[3] = { x: 40, y: 44 };
  for (let i = 0; i < 20; i++) {
    const g = createGame(m, ['a', 'b', 'c'], true);
    assert.ok(g.players.every(p => Math.abs(p.spawn.x - (m.spawns[0].x + 0.5) * CELL) > 1 || Math.abs(p.spawn.z - (m.spawns[0].y + 0.5) * CELL) > 1), 'Conquest never uses the Assault-only spawn');
  }
  const a = createGame({ ...m, defend: [0] }, ['d', 'a'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 0 });
  assert.deepEqual([a.players[0].spawn.x, a.players[0].spawn.z], [(m.spawns[0].x + 0.5) * CELL, (m.spawns[0].y + 0.5) * CELL], 'Assault defends from it');
  assert.equal(validateMap({ ...m, spawns: [{ ...m.spawns[0], assault: true }, { ...m.spawns[1], assault: true }, m.spawns[2]] }), 'needs 2+ spawns that every mode can use');
}

// Pending paratroopers reserve population for the whole stick until it arrives or its plane is shot down.
{
  const stick = SUPPORT.para.units.length;
  const short = fresh(); short.players[0].mp = 10000;
  for (let i = 0; i < popCap(short) - stick + 1; i++) put(short, 0, 'rifle', 10, 10);
  assert.equal(command(short, 0, { t: 'support', kind: 'para', x: 20, z: 12 }), 'pop', 'no drop without room for the whole stick');
  for (const intercepted of [false, true]) {
    const g = fresh(); g.players[0].mp = 10000;
    for (let i = 0; i < popCap(g) - stick; i++) put(g, 0, 'rifle', 10, 10);
    const count = g.units.size;
    command(g, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
    assert.equal(g.strikes.length, 1, 'paratroopers accepted with room for the stick');
    assert.equal(popOf(g, 0), popCap(g), 'pending paratroopers reserve population');
    const mp = g.players[0].mp;
    command(g, 0, { t: 'buy', unit: 'rifle' });
    assert.equal(g.units.size, count, 'recruitment cannot take the paratroopers slot');
    assert.equal(g.players[0].mp, mp, 'rejected recruitment does not spend manpower');
    if (intercepted) g.covers = [{ team: 1, x: 20, z: 12, r: SUPPORT.cover.radius, t: SUPPORT.para.delay + 1 }];
    run(g, SUPPORT.para.delay + 0.2);
    assert.equal(g.units.size, count + (intercepted ? 0 : stick), 'accepted drop arrives unless intercepted');
    assert.equal(g.strikes.length, 0, `paratroopers ${intercepted ? 'shot down' : 'delivered'} leave no pending strike`);
    assert.equal(popOf(g, 0), g.units.size, 'the resolved drop has no pending reservation');
    if (intercepted) {
      command(g, 0, { t: 'buy', unit: 'rifle' });
      assert.equal(g.units.size, count + 1, 'a shoot-down releases the reserved population');
      assert.equal(popOf(g, 0), popCap(g) - stick + 1, 'the whole stick was released');
    }
  }
}

// Fighter Cover hands off its lifetime to the cover zone when it arrives.
{
  const g = fresh(); g.players[0].mp = 5000;
  command(g, 0, { t: 'support', kind: 'cover', x: 20, z: 20 });
  assert.equal(g.strikes.length, 1, 'fighter cover is announced before arrival');
  run(g, SUPPORT.cover.delay + 0.1);
  assert.equal(g.covers.length, 1, 'fighter cover zone starts on arrival');
  assert.equal(g.strikes.length, 0, 'delivered fighter cover no longer appears as an incoming strike');
  run(g, SUPPORT.cover.dur + 1);
  assert.equal(g.covers.length, 0, 'fighter cover zone expires');
  assert.equal(snapshotFor(g, 0, []).strikes.length, 0, 'expired cover has no lingering ring');
}

// Every support call leaves only its intended short-lived effects in both economy modes.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  for (const mode of ['conquest', 'classic']) {
    const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode });
    const p = g.players[0]; p.mp = 5000; if (mode === 'classic') p.mun = 5000;
    const dir = Math.atan2(g.h * CELL / 2 - p.spawn.z, g.w * CELL / 2 - p.spawn.x);
    const x = p.spawn.x + Math.cos(dir) * 28, z = p.spawn.z + Math.sin(dir) * 28;
    run(g, 0.2);
    for (const kind of Object.keys(SUPPORT)) command(g, 0, { t: 'support', kind, x, z });
    assert.deepEqual(g.strikes.map(s => s.kind), Object.keys(SUPPORT), `${mode} accepted every support kind`);
    run(g, 200);
    for (const key of ['strikes', 'covers', 'smokes', 'nades', 'salvos'])
      assert.equal(g[key].length, 0, `${mode} ${key} expire after every support resolves`);
  }
}

// Aviation: air support (dive bomber, paratroopers, fighter cover), flak shoot-downs, planes on sorties, anti-air.
{
  const R = Math.random;
  // dive bomber: one heavy bomb right on the spot
  const d = fresh(); d.players[0].mp = d.players[1].mp = 1000;
  const tank = put(d, 1, 'tank', 30, 30); run(d, 0.2);
  command(d, 0, { t: 'support', kind: 'dive', x: 30, z: 30 });
  run(d, SUPPORT.dive.delay + 0.5);
  assert.ok(tank.hp <= 0 || !d.units.has(tank.id), 'a dive bomber kills a tank it lands on');
  assert.equal(d.strikes.length, 0, 'delivered dive bomber leaves no pending strike');
  // paratroopers: only where your side can see, and they arrive as two rifle squads and an MG team
  const pa = fresh(); pa.players[0].mp = 1000;
  const eye = put(pa, 0, 'rifle', 10, 10); run(pa, 0.3);
  command(pa, 0, { t: 'support', kind: 'para', x: 300, z: 300 });
  assert.equal(pa.strikes.length, 0, 'no drop where nobody sees');
  command(pa, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
  run(pa, SUPPORT.para.delay + 0.5);
  assert.equal([...pa.units.values()].filter(u => u.owner === 0 && u.type === 'rifle').length, 3, 'two rifle squads dropped in');
  assert.equal([...pa.units.values()].filter(u => u.owner === 0 && u.type === 'mg').length, 1, 'with an MG team');
  assert.equal(pa.strikes.length, 0, 'delivered paratroopers leave no pending strike');
  // fighter cover intercepts the next enemy strike over it (but never recon)
  const fc = fresh(); fc.players[0].mp = fc.players[1].mp = 2000;
  const target = put(fc, 1, 'tank', 30, 30); run(fc, 0.2);
  command(fc, 1, { t: 'support', kind: 'cover', x: 30, z: 30 }); run(fc, SUPPORT.cover.delay + 0.2);
  command(fc, 0, { t: 'support', kind: 'recon', x: 30, z: 30, dir: 0 }); run(fc, SUPPORT.recon.delay + 0.2);
  assert.ok(fc.strikes.some(q => q.kind === 'recon' && q.live), 'recon flies through fighter cover');
  command(fc, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fc, SUPPORT.dive.delay + 0.5);
  assert.ok(fc.units.has(target.id) && target.hp === UNITS.tank.hpPer, 'the dive bomber was shot down: no damage');
  assert.equal(fc.strikes.filter(q => q.kind === 'dive').length, 0, 'intercepted dive bomber leaves no pending strike');
  assert.equal(fc.covers.length, 0, 'fighter cover is used up');
  // flak: each gun in range rolls its chance to shoot a support plane down
  const fk = fresh(); fk.players[0].mp = fk.players[1].mp = 2000;
  const t2 = put(fk, 1, 'tank', 30, 30), gun = put(fk, 1, 'flak', 34, 30); run(fk, 3);
  Math.random = () => 0; // every roll hits
  command(fk, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fk, SUPPORT.dive.delay + 0.5);
  Math.random = R;
  assert.equal(t2.hp, UNITS.tank.hpPer, 'flak shot the dive bomber down');
  assert.equal(fk.strikes.length, 0, 'flak shot-down leaves no pending strike');
  // flak can't hurt tanks
  const fv = fresh(); fv.players[0].mp = fv.players[1].mp = 2000;
  const tk = put(fv, 1, 'tank', 20, 20), fl = put(fv, 0, 'flak', 34, 20); run(fv, 6);
  assert.equal(tk.hp, UNITS.tank.hpPer, 'flak does nothing to a tank');
}
{
  // a plane's sortie: at base, out to the mission, circling, home when the fuel runs out, rearm, ready again
  const big = Array(60).fill('.'.repeat(60)); // 120 m: room to fly
  const g = fresh(big); g.players[0].mp = g.players[1].mp = 5000;
  g.players[0].spawn = { x: 10, z: 10 }; g.players[1].spawn = { x: 70, z: 70 };
  const f = put(g, 0, 'fighter', 0, 0); run(g, 0.1);
  assert.equal(f.air.state, 'base', 'a new plane waits at its base');
  assert.ok(snapshotFor(g, 0, []).units.find(u => u[0] === f.id)[12] & 512, 'flagged at base for its owner');
  command(g, 0, { t: 'move', orders: [[f.id, 40, 40]] });
  run(g, 3);
  assert.ok(f.air.state === 'out' || f.air.state === 'station', 'took off');
  run(g, 4);
  assert.equal(f.air.state, 'station', 'circling the mission');
  assert.ok(Math.hypot(f.x - 40, f.z - 40) < CFG.air.orbit + 3, 'over the spot');
  // enemies see it from afar without line of sight, rifles can't shoot it
  const watcher = put(g, 1, 'rifle', 40, 75); run(g, 0.3); // 35 m from the spot, the plane circles 18 m around it
  assert.equal(g.players[1].visible.has(f.id), true, 'seen from afar, over the circle');
  run(g, CFG.air.station + 6);
  assert.ok(f.air.state === 'home' || f.air.state === 'rearm', 'fuel spent: heading home');
  run(g, 6 + CFG.air.rearm);
  assert.equal(f.air.state, 'base', 'rearmed and ready');
  assert.equal(g.players[1].visible.has(f.id), false, 'invisible at base');
  // ground attack: a plane on an attack mission damages its target; flak over it shoots it down
  const ga = fresh(big); ga.players[0].mp = ga.players[1].mp = 5000;
  ga.players[0].spawn = { x: 10, z: 10 }; ga.players[1].spawn = { x: 80, z: 80 };
  const at = put(ga, 0, 'attacker', 0, 0), tank = put(ga, 1, 'tank', 50, 50), spot = put(ga, 0, 'rifle', 30, 50);
  run(ga, 0.5);
  command(ga, 0, { t: 'attack', ids: [at.id], target: tank.id });
  const random = Math.random;
  try { Math.random = () => 0; run(ga, 15); } finally { Math.random = random; }
  assert.ok(tank.hp < UNITS.tank.hpPer, `the ground-attack plane hit the tank (${tank.hp})`);
  const fl1 = put(ga, 1, 'flak', 52, 50), fl2 = put(ga, 1, 'flak', 48, 50);
  // Ready guns and a damaged plane make this shoot-down and bounty check deterministic.
  fl1.still = fl2.still = 2; at.hp = 50; at.cooldown = 1e9;
  const mp1 = ga.players[1].mp;
  run(ga, 2);
  assert.ok(!ga.units.has(at.id), 'two flak guns shot the plane down');
  assert.ok(ga.players[1].mp > mp1 + UNITS.attacker.cost * CFG.bounty * 0.9, 'and paid the kill bounty');
}
{
  // Classic: an Airfield (needs a Motor Pool) trains planes, which use it as their base
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), p = g.players[0];
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq'), eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  p.mp = 9000; p.fuel = 500; eng.x = hq.x; eng.z = hq.z + 10;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'airfield', x: hq.x + 10, z: hq.z + 18 });
  assert.ok(![...g.units.values()].some(u => u.type === 'airfield'), 'no Airfield without a Motor Pool');
  for (const [t, dx] of [['barracks', -8], ['motorpool', 8], ['airfield', 26]]) {
    command(g, 0, { t: 'build', ids: [eng.id], kind: t, x: hq.x + dx, z: hq.z + 18 });
    const b = [...g.units.values()].find(u => u.type === t && u.owner === 0); assert.ok(b, t + ' placed'); b.built = 1; b.hp = UNITS[t].hpPer;
  }
  const af = [...g.units.values()].find(u => u.type === 'airfield');
  command(g, 0, { t: 'buy', unit: 'fighter', from: af.id });
  assert.deepEqual(af.queue, ['fighter'], 'fighter queued at the Airfield');
  assert.equal(p.fuel, 500 - UNITS.fighter.fuel, 'planes cost Fuel in Classic');
  run(g, UNITS.fighter.train + 1);
  const f = [...g.units.values()].find(u => u.type === 'fighter');
  assert.ok(f && f.air.state === 'base' && Math.hypot(f.x - af.x, f.z - af.z) < 1, 'the new fighter sits at its Airfield');
  const site = sim.siteNear(g, af.x + 40, af.z, UNITS.airfield.size);
  assert.ok(site, 'there is an open site for the distant Airfield');
  eng.x = site.x; eng.z = site.z + 5;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'airfield', x: site.x, z: site.z });
  const far = [...g.units.values()].find(u => u.type === 'airfield' && u.id !== af.id);
  assert.ok(far, 'a second Airfield can be placed away from the HQ');
  far.built = 1; far.hp = UNITS.airfield.hpPer;
  command(g, 0, { t: 'buy', unit: 'fighter', from: far.id });
  run(g, UNITS.fighter.train + 0.1);
  const second = [...g.units.values()].find(u => u.type === 'fighter' && u.id !== f.id);
  assert.ok(second && Math.hypot(second.x - far.x, second.z - far.z) < 1, 'a plane trained at the distant Airfield starts at that Airfield');
}
{
  // kill bounty: 20% of the dead unit's cost to the enemy who finished it
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const a = put(g, 0, 'rifle', 10, 10), b = put(g, 1, 'rifle', 30, 10); b.hp = 1;
  const mp0 = g.players[0].mp;
  run(g, 3);
  assert.ok(!g.units.has(b.id), 'enemy squad died');
  assert.ok(g.players[0].mp >= mp0 + UNITS.rifle.cost * CFG.bounty - 0.01, `bounty paid (${g.players[0].mp - mp0})`);
}

// Fighter Cover stops one strike even when two planes arrive on the same tick.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 2000;
  const tank = put(g, 1, 'tank', 30, 30);
  command(g, 1, { t: 'support', kind: 'cover', x: 30, z: 30 });
  run(g, SUPPORT.cover.delay + 0.1);
  command(g, 0, { t: 'support', kind: 'dive', x: 30, z: 30 });
  command(g, 0, { t: 'support', kind: 'strafe', x: 30, z: 30, dir: 0 });
  run(g, SUPPORT.dive.delay + 0.1);
  assert.equal(g.shots.filter(s => s.k === 'shotdown').length, 1, 'Fighter Cover intercepts only one simultaneous arrival');
  assert.ok(tank.hp < UNITS.tank.hpPer, 'the second strike delivers its attack');
}

// A returning plane disappears from enemy snapshots immediately on reaching base.
{
  const g = fresh(Array(60).fill('.'.repeat(60))); g.players[0].mp = g.players[1].mp = 1000;
  g.players[0].spawn = { x: 10, z: 60 };
  const plane = put(g, 0, 'fighter', 0, 0);
  put(g, 1, 'rifle', 5, 60);
  run(g, 0.2);
  plane.x += 4; plane.air.state = 'home';
  step(g);
  assert.equal(plane.air.state, 'rearm', 'the returning plane reaches its base');
  assert.equal(snapshotFor(g, 1, []).units.some(u => u[0] === plane.id), false, 'a rearming plane is hidden even between vision updates');
}

// Spot visibility follows the same airborne rules as unit visibility.
{
  const g = fresh(); g.players[0].mp = 1000;
  const plane = put(g, 0, 'fighter', 10, 10);
  assert.equal(teamSees(g, 0, { x: 12, z: 10 }), false, 'a parked plane cannot spot a paratrooper landing');
}
{
  const rows = [...empty]; rows[5] = '.'.repeat(10) + 'B' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = 1000;
  const plane = put(g, 0, 'fighter', 10, 11);
  command(g, 0, { t: 'move', orders: [[plane.id, 30, 11]] });
  assert.equal(los(g, plane, { x: 30, z: 11 }), false, 'the house blocks a ground observer');
  assert.equal(teamSees(g, 0, { x: 30, z: 11 }), true, 'an airborne plane spots landing ground across a house');
}

// Bridge demolition affects the ground units on it, while planes fly above it.
{
  const rows = [...empty]; rows[10] = '.'.repeat(10) + '=' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const plane = put(g, 0, 'fighter', 20.2, 20.2);
  command(g, 0, { t: 'move', orders: [[plane.id, 20.2, 20.2]] });
  command(g, 1, { t: 'support', kind: 'dive', x: 21, z: 21 });
  g.strikes[0].t = 0;
  step(g);
  assert.equal(g.chars[10 * g.w + 10], 'W', 'the bridge is demolished');
  assert.equal(g.units.has(plane.id), true, 'demolishing a bridge cannot kill a plane above it');
  assert.equal(plane.hp, UNITS.fighter.hpPer, 'the ground explosion does not damage the plane');
}

// Shoot-down events do not expose commandable planes to a team outside vision.
{
  const g = fresh(Array(60).fill('.'.repeat(60)), 3);
  g.players.forEach(p => { p.mp = 2000; });
  const plane = put(g, 0, 'fighter', 30, 30);
  put(g, 1, 'flaktrack', 32, 30);
  command(g, 0, { t: 'move', orders: [[plane.id, 30, 30]] });
  plane.hp = 1;
  step(g);
  assert.equal(g.units.has(plane.id), false, 'mobile flak shoots down the plane');
  assert.ok(snapshotFor(g, 0, g.shots).shots.some(s => s.k === 'planedown'), 'the owner receives its shoot-down event');
  assert.equal(snapshotFor(g, 2, g.shots).shots.some(s => s.k === 'planedown'), false, 'a hidden shoot-down does not reveal the plane to a third team');
}

// Public support effects preserve the announcement without revealing hidden flak IDs.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 2000;
  const gun = put(g, 1, 'flak', 30, 30);
  run(g, 3);
  const random = Math.random;
  try {
    Math.random = () => 0;
    command(g, 0, { t: 'support', kind: 'dive', x: 30, z: 30 });
    run(g, SUPPORT.dive.delay + 0.1);
  } finally { Math.random = random; }
  assert.equal(g.players[0].visible.has(gun.id), false, 'the flak gun stays outside vision');
  const flak = snapshotFor(g, 0, g.shots).shots.find(s => s.k === 'flak');
  assert.ok(flak, 'the public strike still shows interception fire');
  assert.equal(flak.f, undefined, 'public flak effects omit a hidden shooter ID');
  assert.ok(g.shots.find(s => s.k === 'flak').f === gun.id, 'filtering one snapshot preserves the event for other viewers');
}

// Hidden Classic buildings do not announce their destruction to uninvolved teams.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c'], false, [0, 1, 2], [0, 1, 2], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  run(g, 0.2);
  assert.equal(g.players[2].visible.has(hq.id), false, 'the distant HQ is hidden');
  hq.hp = 0;
  step(g);
  assert.ok(snapshotFor(g, 0, g.shots).shots.some(s => s.k === 'collapse' && s.x === hq.x), 'the owner sees its HQ collapse');
  assert.equal(snapshotFor(g, 2, g.shots).shots.some(s => s.k === 'collapse' && s.x === hq.x), false, 'a hidden HQ collapse does not disclose its position');
}

// An incoming paratrooper drop cannot recreate an eliminated player's army.
for (const mode of ['classic', 'annihilation']) {
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c'], false, mode === 'classic' ? [0, 0, 1] : [0, 1, 2], [0, 1, 2], { mode });
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === (mode === 'classic' ? 'hq' : 'bunker'));
  g.players[0].mun = 1000; g.players[0].mp = 1000;
  command(g, 0, { t: 'support', kind: 'para', x: hq.x + 10, z: hq.z });
  assert.equal(g.strikes.length, 1, 'the visible drop is ordered before elimination');
  hq.hp = 0; step(g);
  assert.equal(g.players[0].out, true, `${mode}: the player loses its last base`);
  assert.equal(g.winner, null, `${mode}: surviving players keep the match running`);
  run(g, SUPPORT.para.delay + 0.1);
  assert.equal([...g.units.values()].some(u => u.owner === 0), false, 'paratroopers do not revive an eliminated army');
}

// A plane overhead is not solid cover for infantry below it.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 2000;
  const rifle = put(g, 0, 'rifle', 10, 10);
  const plane = put(g, 0, 'fighter', 12, 10);
  command(g, 0, { t: 'move', orders: [[plane.id, 12, 10]] });
  assert.equal(snapshotFor(g, 0, []).units.find(u => u[0] === rifle.id)[10], 0, 'a nearby plane does not mark infantry as next to cover');
  const shooter = put(g, 1, 'rifle', 30, 10);
  rifle.cooldown = plane.cooldown = 1e9;
  const random = Math.random;
  try { Math.random = () => 0.5; step(g); } finally { Math.random = random; }
  assert.ok(rifle.hp < UNITS.rifle.models * UNITS.rifle.hpPer, 'a plane does not block ground fire aimed at the squad');
}

// A vehicle killed earlier in a tick cannot fire after its destruction.
{
  const g = fresh(empty, 3); g.players.forEach(p => { p.mp = 1000; });
  const killer = put(g, 0, 'tank', 10, 10), doomed = put(g, 1, 'tank', 30, 10);
  const rifle = put(g, 2, 'rifle', 34, 10);
  doomed.hp = 1; rifle.cooldown = 1e9;
  const random = Math.random;
  try { Math.random = () => 0; step(g); } finally { Math.random = random; }
  assert.equal(g.units.has(doomed.id), false, 'the first tank destroys the enemy tank');
  assert.equal(rifle.hp, UNITS.rifle.models * UNITS.rifle.hpPer, 'a destroyed tank cannot fire later in the same tick');
  assert.equal(g.shots.some(s => s.f === doomed.id), false, 'the destroyed tank produces no firing event');
}

// Ghosts use airborne visibility: parked planes cannot spot, flying planes see across terrain.
for (const flying of [false, true]) {
  const rows = Array(80).fill('.'.repeat(80)); if (flying) rows[73] = 'B'.repeat(80);
  const map = { w: 80, h: 80, rows, spawns: [{ x: 2, y: 2 }, { x: 77, y: 77 }, { x: 2, y: 77 }], points: [{ x: 40, y: 40 }] };
  const g = createGame(map, ['a', 'b', 'c'], false, [0, 1, 1], [0, 1, 2], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  const scout = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  Object.assign(scout, { x: hq.x - 12, z: hq.z, cooldown: 1e9 }); run(g, 0.2);
  assert.ok(snapshotFor(g, 0, []).units.some(u => u[0] === hq.id), 'the scout sees the HQ before leaving');
  Object.assign(scout, g.players[0].spawn); run(g, 0.2);
  g.players[0].spawn = { x: 110, z: 110 }; g.players[0].mp = 1000;
  const mode = g.mode; g.mode = null; command(g, 0, { t: 'buy', unit: 'fighter' }); g.mode = mode;
  const plane = [...g.units.values()].find(u => u.type === 'fighter');
  assert.equal(plane.air.state, 'base', 'the nearby plane remains parked');
  assert.ok(Math.hypot(plane.x - hq.x, plane.z - hq.z) < UNITS.fighter.vision, 'the parked plane is within spotting range of the Ghost');
  if (flying) {
    assert.equal(los(g, plane, hq), false, 'the houses block ground sight to the HQ');
    command(g, 0, { t: 'move', orders: [[plane.id, plane.x, plane.z]] });
  }
  hq.hp = 0; run(g, 0.3);
  assert.equal(g.winner, null, 'the enemy teammate keeps the match running');
  assert.equal(snapshotFor(g, 0, []).ghosts.some(gh => gh[0] === hq.id), !flying,
    flying ? 'a flying plane clears a destroyed building Ghost across terrain' : 'a parked plane cannot clear a destroyed building Ghost under fog');
}

// A ground attack order cannot lock onto a visible plane it cannot shoot.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 2000;
  const rifle = put(g, 0, 'rifle', 10, 10), enemy = put(g, 1, 'rifle', 18, 10);
  const plane = put(g, 1, 'fighter', 20, 10);
  Object.assign(plane.air, { state: 'station', mission: { kind: 'patrol', x: 20, z: 10 } });
  rifle.cooldown = enemy.cooldown = 1e9;
  run(g, 0.2);
  assert.ok(g.players[0].visible.has(plane.id), 'the plane is visible to the squad');
  command(g, 0, { t: 'attack', ids: [rifle.id], target: plane.id });
  assert.equal(rifle.attackId, 0, 'ground units ignore an attack order against a plane');
  rifle.targetId = 0; rifle.retarget = 0;
  step(g);
  assert.equal(rifle.targetId, enemy.id, 'the squad still picks a ground enemy automatically');
  const fighter = put(g, 0, 'fighter', 12, 10);
  command(g, 0, { t: 'attack', ids: [fighter.id], target: plane.id });
  assert.equal(fighter.air.mission?.id, plane.id, 'fighters can still be sent after planes');
}

// Plans: snapshots carry your own units' routes and locked targets, never anyone else's.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const a = put(g, 0, 'rifle', 5, 5), b = put(g, 1, 'rifle', 20, 5);
  run(g, 0.3);
  command(g, 0, { t: 'move', orders: [[a.id, 30, 30]] });
  let plans = snapshotFor(g, 0, []).plans;
  assert.deepEqual(plans.map(q => q[0]), [a.id], 'only my units');
  assert.equal(plans[0][1], 1, 'moving'); assert.ok(plans[0].length > 4, 'with waypoints');
  command(g, 0, { t: 'attack', ids: [a.id], target: b.id });
  plans = snapshotFor(g, 0, []).plans;
  assert.deepEqual(plans[0].slice(1, 4), [4, b.x, b.z], 'locked onto the target it was ordered to attack');
}

// Terrain replay stays bounded when the same construction site is placed and cancelled repeatedly.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const p = g.players[0], eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  const node = g.nodes.filter(n => !n.fuel).sort((a, b) => Math.hypot(a.x - eng.x, a.z - eng.z) - Math.hypot(b.x - eng.x, b.z - eng.z))[0];
  eng.x = node.x + 8; eng.z = node.z; p.mp = 10000; p.mun = 100;
  const orig = Math.random;
  try {
    const rolls = Array.from({ length: SUPPORT.artillery.shells }, (_, i) => [
      0.5 + (i % 2 ? 1 : -1) / SUPPORT.artillery.len,
      0.5 + (Math.floor(i / 2) % 2 ? 1 : -1) / SUPPORT.artillery.width,
    ]).flat();
    Math.random = () => rolls.shift() ?? 0.5;
    command(g, 0, { t: 'support', kind: 'artillery', x: node.x, z: node.z, dir: 0 });
    run(g, SUPPORT.artillery.delay + SUPPORT.artillery.shells * SUPPORT.artillery.every + 0.3);
  } finally { Math.random = orig; }
  const hole = Math.floor(node.z / CELL) * g.w + Math.floor(node.x / CELL);
  assert.ok(g.height[hole] < 0, 'terrain replay fixture has a crater under the future site');
  let emitted, emittedBefore;
  for (let i = 0; i < 20; i++) {
    const at = g.newCells.length;
    command(g, 0, { t: 'build', ids: [eng.id], kind: 'depot', x: node.x, z: node.z });
    const site = g.units.get(node.depot);
    assert.ok(site, `terrain replay cycle ${i}: a legitimate construction site is accepted`);
    if (i === 0) { emitted = g.newCells.slice(at); emittedBefore = structuredClone(emitted); }
    command(g, 0, { t: 'cancel', id: site.id });
    assert.equal(node.depot, 0, `terrain replay cycle ${i}: the node is free after cancellation`);
  }
  assert.equal(g.cellLog.length, new Set(g.cellLog.map(([c]) => c)).size, 'terrain replay keeps one latest entry per changed cell');
  assert.equal(g.cellLog.find(([c]) => c === hole)[2], g.height[hole], 'later character changes retain the crater height for reconnecting players');
  assert.ok(g.cellLog.every(([c, ch]) => ch === g.chars[c]), 'terrain replay contains the current character for each cell');
  assert.deepEqual(emitted, emittedBefore, 'later terrain changes do not mutate previously emitted incremental updates');
  assert.equal(g.newCells.length > g.cellLog.length, true, 'incremental updates keep every transition for connected players');
}

// Idle troops wait for their next target search, but immediately replace a target that dies.
{
  const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
  const rifle = put(g, 0, 'rifle', 5, 5), first = put(g, 1, 'rifle', 40, 5), next = put(g, 1, 'rifle', 40, 10);
  first.cooldown = next.cooldown = 1e9;
  const orig = Math.random;
  try {
    Math.random = () => 0;
    step(g);
    assert.equal(rifle.targetId, 0, 'no target before an enemy enters weapon range');
    first.x = 20;
    step(g);
    assert.equal(first.hp, UNITS.rifle.models * UNITS.rifle.hpPer, 'a newly arrived enemy waits for the scheduled target search');
    run(g, 0.6);
    assert.ok(first.hp < UNITS.rifle.models * UNITS.rifle.hpPer, 'troops acquire and shoot the enemy when the search timer expires');
    assert.equal(rifle.targetId, first.id, 'the first target is acquired');
    first.hp = 0; next.x = 20; rifle.cooldown = 0;
    step(g);
    assert.equal(rifle.targetId, next.id, 'a dead current target is replaced without waiting for the timer');
    assert.ok(next.hp < UNITS.rifle.models * UNITS.rifle.hpPer, 'the replacement target is shot immediately');
  } finally { Math.random = orig; }
}

// ---------- Unit behavior (DESIGN.md "Unit behavior") ----------
// An 80 x 60 m field; `edit` gets the rows as character arrays. Passive enemies are seen but never pick a target or
// shoot, so only the unit under test decides anything.
const field = (edit = () => {}) => { const rows = Array.from({ length: 30 }, () => Array(40).fill('.')); edit(rows); return rows.map(r => r.join('')); };
// (a shot wakes up a passive unit's target search, so the units under test hold their fire)
const passive = u => Object.assign(u, { retarget: 1e9, cooldown: 1e9 }), holdFire = u => Object.assign(u, { cooldown: 1e9 });
const covered = (g, p) => (g.flags[Math.floor(p.z / CELL) * g.w + Math.floor(p.x / CELL)] & sim.COVER) > 0;
const hedge = rows => { for (let y = 3; y < 27; y++) rows[y][20] = 'H'; }; // x 40 to 42 m, z 6 to 54 m
// sheltered from the east: in the hedge or close behind it (the sim counts solid ground within 2.2 m toward the shooter)
const behindHedge = p => p.x >= 40 - 2.2 && p.x < 42 && p.z > 6 && p.z < 54;

// Targets by job: snipers hunt heavy-weapon crews, mortars dug-in squads, AT guns vehicles.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const sniper = holdFire(put(g, 0, 'sniper', 5, 21)), rifle = passive(put(g, 1, 'rifle', 17, 21)), mg = passive(put(g, 1, 'mg', 35, 21));
  run(g, 1);
  assert.equal(sniper.targetId, mg.id, 'a sniper picks the MG crew 30 m away over a rifle squad 12 m away');
  assert.ok(rifle.hp > 0);
}
{
  const g = fresh(field(r => { r[20][16] = 'T'; })); g.players[0].mp = g.players[1].mp = 5000;
  const mortar = holdFire(put(g, 0, 'mortar', 5, 41)), open = passive(put(g, 1, 'rifle', 22, 41)), dug = passive(put(g, 1, 'rifle', 33, 41));
  dug.shotAt = g.tick; // it has been firing, so the trench does not hide it
  run(g, 1);
  assert.ok(inTrench(g, dug) && !inTrench(g, open));
  assert.equal(mortar.targetId, dug.id, 'a mortar shells the squad in a trench 28 m away over one in the open 17 m away');
}
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const at = holdFire(put(g, 0, 'at', 5, 21)), rifle = passive(put(g, 1, 'rifle', 12, 21)), tank = passive(put(g, 1, 'tank', 33, 21));
  tank.rot = Math.PI; // front to the gun
  run(g, 1);
  assert.equal(at.targetId, tank.id, 'an AT gun picks the tank over a rifle squad at a quarter of the range');
  assert.ok(rifle.hp > 0);
}

// Targets by threat, with hysteresis: a squad keeps its target unless another one is clearly better, answers whoever
// is shooting at it first, and a player-ordered target beats both.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const u = holdFire(put(g, 0, 'rifle', 10, 21)), a = passive(put(g, 1, 'rifle', 30, 21)), b = passive(put(g, 1, 'rifle', 10, 46));
  const moveTo = (t, x, z) => { Object.assign(t, { x, z }); updateGrid(g, t); };
  run(g, 1);
  assert.equal(u.targetId, a.id, 'the nearer of two equal squads first (20 m against 25 m)');
  moveTo(b, 10, 38); run(g, 1);
  assert.equal(u.targetId, a.id, 'a squad a little closer (17 m against 20 m) does not take over');
  moveTo(b, 10, 34); run(g, 1);
  assert.equal(u.targetId, b.id, 'a clearly closer squad (13 m against 20 m) does');
  Object.assign(u, { hitBy: a.id, hitAt: g.tick, hitFrom: { x: a.x, z: a.z }, retarget: 0 }); step(g);
  assert.equal(u.targetId, a.id, 'the squad that just shot at it comes first, though it is farther away');
  command(g, 0, { t: 'attack', ids: [u.id], target: b.id }); run(g, 1);
  Object.assign(u, { hitBy: a.id, hitAt: g.tick, retarget: 0 }); run(g, 1);
  assert.equal(u.targetId, b.id, 'an ordered target stays the target while another squad shoots at it');
}

// Cover at the end of a move: a squad sent to open ground 5 m short of a hedge (heading east, so the enemy is
// probably east) settles right behind it, but never into a spot another squad holds.
{
  const g = fresh(field(hedge)); g.players[0].mp = 5000;
  const u = put(g, 0, 'rifle', 10, 21);
  command(g, 0, { t: 'move', orders: [[u.id, 35, 21]] });
  run(g, 10);
  assert.ok(behindHedge(u) && Math.hypot(u.x - 35, u.z - 21) <= CFG.behavior.coverSeek, `settles behind the hedge (${u.x}, ${u.z})`);
  const v = put(g, 0, 'rifle', 10, 31);
  command(g, 0, { t: 'move', orders: [[v.id, 36, 24]] });
  run(g, 10);
  assert.ok(behindHedge(v), `the second squad finds its own spot at the hedge (${v.x}, ${v.z})`);
  assert.ok(Math.hypot(v.x - u.x, v.z - u.z) >= CFG.behavior.spacing - 0.25, 'and keeps its distance from the squad already there');
}
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const u = put(g, 0, 'rifle', 10, 21);
  command(g, 0, { t: 'move', orders: [[u.id, 38, 21]] });
  run(g, 10);
  assert.ok(Math.hypot(u.x - 38, u.z - 21) < 1, 'with no cover nearby the squad goes exactly where it was sent');
}

// Under fire: an idle squad in the open shifts into cover within a few metres if it can shoot back, and farther if
// it can't (out of range or unseen).
{
  const g = fresh(field(hedge)); g.players[0].mp = g.players[1].mp = 5000;
  const orig = Math.random;
  try {
    Math.random = () => 0;
    const u = put(g, 0, 'rifle', 45, 21); put(g, 1, 'mg', 70, 21);
    run(g, 6);
    assert.ok(covered(g, u), `a squad under MG fire moves 4 m into the hedge (${u.x}, ${u.z})`);
  } finally { Math.random = orig; }
}
{
  const g = fresh(field(hedge)); g.players[0].mp = 5000;
  const u = put(g, 0, 'rifle', 48, 21);
  Object.assign(u, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 21 } });
  run(g, 3);
  assert.ok(covered(g, u), `a squad shot at from out of its reach moves 7 m into the hedge (${u.x}, ${u.z})`);
  const w = put(g, 0, 'rifle', 52, 21);
  Object.assign(w, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 21 } });
  run(g, 3);
  assert.ok(Math.hypot(w.x - 52, w.z - 21) < 1, 'cover farther than CFG.coverSeek is out of reach: the squad stays put');
}

// Return fire: a fresh squad walking to its rally point stops to answer a shooter; a squad under a plain move
// order keeps walking.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const orig = Math.random;
  try {
    Math.random = () => 0.99; // misses only: nobody dies or gets pinned
    const u = put(g, 0, 'rifle', 10, 31), v = put(g, 0, 'rifle', 10, 11);
    const a = put(g, 1, 'rifle', 30, 45), b = put(g, 1, 'rifle', 30, 1);
    u.path = findPath(g, u, { x: 75, z: 31 }); u.drift = 'rally';
    command(g, 0, { t: 'move', orders: [[v.id, 75, 11]] });
    command(g, 1, { t: 'attack', ids: [a.id], target: u.id }); command(g, 1, { t: 'attack', ids: [b.id], target: v.id });
    run(g, 2);
    assert.ok(u.amove && u.targetId === a.id, 'the rally walker turns its walk into an attack-move and answers the shooter');
    const x = u.x; run(g, 1);
    assert.ok(Math.abs(u.x - x) < 0.5, 'and halts while the shooter is in range');
    assert.ok(v.path.length && v.x > 20 && !v.amove, 'a squad under a move order keeps walking');
  } finally { Math.random = orig; }
}

// Facing: a stationary tank turns its front to incoming fire it can't answer, and keeps it on the target it fights.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const tank = put(g, 0, 'tank', 40, 20); tank.rot = 0;
  Object.assign(tank, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 5, z: 20 } });
  run(g, 2.5);
  assert.ok(Math.cos(tank.rot - Math.PI) > 0.95, `the hull turns to the shot from behind (rot ${tank.rot})`);
  const foe = passive(put(g, 1, 'tank', 40, 52));
  run(g, 2);
  assert.equal(tank.targetId, foe.id);
  assert.ok(Math.cos(tank.rot - Math.PI / 2) > 0.95, `the hull turns to the tank it engages (rot ${tank.rot})`);
}

// Short retreats: a tank in a fight backs up a short way with its front to the enemy; out of a fight it turns around.
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const fighting = put(g, 0, 'tank', 50, 15), calm = put(g, 0, 'tank', 50, 45);
  fighting.rot = calm.rot = 0;
  Object.assign(fighting, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 15 } });
  command(g, 0, { t: 'move', orders: [[fighting.id, 40, 15], [calm.id, 40, 45]] });
  run(g, 1.5);
  assert.ok(fighting.x < 48 && Math.cos(fighting.rot) > 0.99, `the engaged tank reverses, front still east (${fighting.x}, rot ${fighting.rot})`);
  assert.ok(Math.cos(calm.rot) < -0.9, 'the tank out of a fight turns around and drives');
  run(g, 4);
  assert.ok(Math.hypot(fighting.x - 40, fighting.z - 15) < 1, 'the reversing tank still gets there');
}

// A hurt vehicle shot at from beyond its reach backs off, front first, unless it is holding a capture point.
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const tank = put(g, 0, 'tank', 50, 40); tank.rot = 0; tank.hp = 100;
  Object.assign(tank, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 40 } });
  run(g, 4);
  assert.ok(tank.x < 46 && Math.cos(tank.rot) > 0.95, `pulls back with its front to the fire (${tank.x}, rot ${tank.rot})`);
  const holder = put(g, 0, 'tank', g.points[0].x + 2, g.points[0].z); holder.hp = 100;
  Object.assign(holder, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: g.points[0].z } });
  run(g, 2);
  assert.ok(Math.hypot(holder.x - g.points[0].x - 2, holder.z - g.points[0].z) < 1, 'a vehicle on a capture point holds it');
}

// Spreading: squads sent to one spot (as the AI does) get their own end spots; idle squads on top of each other
// spread to the spacing.
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const squads = Array.from({ length: 6 }, (_, i) => put(g, 0, 'rifle', 10, 15 + i * 3));
  command(g, 0, { t: 'move', orders: squads.map(u => [u.id, 60, 30]) });
  const ends = squads.map(u => u.path.at(-1));
  const gaps = ends.flatMap((p, i) => ends.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.z - q.z)));
  assert.ok(Math.min(...gaps) >= CFG.behavior.spacing, `distinct end spots (closest pair ${Math.min(...gaps).toFixed(2)} m)`);
  assert.ok(ends.every(p => Math.hypot(p.x - 60, p.z - 30) < 12), 'all around the ordered spot');
  const a = put(g, 0, 'rifle', 30, 50), b = put(g, 0, 'rifle', 30.5, 50);
  run(g, 4);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= CFG.behavior.spacing - 0.25, `idle squads spread out (${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)} m)`);
}
// Squads sent to a capture point's center all end inside its circle (the AI sends whole groups there).
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const p = g.points[0], squads = Array.from({ length: 9 }, (_, i) => put(g, 0, 'rifle', 60, 10 + i * 5));
  command(g, 0, { t: 'move', orders: squads.map(u => [u.id, p.x, p.z]) });
  const far = Math.max(...squads.map(u => Math.hypot(u.path.at(-1).x - p.x, u.path.at(-1).z - p.z)));
  assert.ok(far <= CFG.pointRadius, `every end spot is on the point (farthest ${far.toFixed(1)} m)`);
}
// A formation spot across water or a cliff from the click falls back to the near side: nobody walks the long way
// round, and nobody is left without a path.
for (const [name, edit, heights] of [['river', r => { for (let x = 0; x < 39; x++) r[20][x] = 'W'; }], ['cliff', () => {}, true]]) {
  const map = blank(field(edit));
  if (heights) map.heights = Array.from({ length: 30 }, (_, y) => (y >= 20 ? '2' : '0').repeat(40));
  const g = createGame(map, ['a', 'b'], false); g.units.clear(); g.players.forEach(p => (p.spawn = { x: -1000, z: -1000 }, p.mp = 5000));
  const squads = Array.from({ length: 9 }, (_, i) => put(g, 0, 'rifle', 5.3, 10.3 + i * 3));
  command(g, 0, { t: 'move', orders: squads.map(u => [u.id, 60.3, 37.3]) });
  assert.ok(squads.every(u => u.path.length && u.path.at(-1).z < 40), `${name}: every squad gets a spot on the near side`);
}

// Crossfire: a squad or tank shot at by two squads keeps its target instead of swapping each time the other lands a
// shot (every recent shooter counts as a threat, not only the last one).
for (const type of ['rifle', 'tank']) {
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const orig = Math.random;
  try {
    Math.random = () => 0.99; // misses only
    const u = put(g, 0, type, 40.3, 40.3), a = put(g, 1, 'rifle', 22.3, 32.3), b = put(g, 1, 'rifle', 58.3, 32.3);
    command(g, 1, { t: 'attack', ids: [a.id, b.id], target: u.id }); b.cooldown = 0.7;
    let last = 0, switches = 0;
    for (let i = 0; i < 20 * 20; i++) { step(g); if (u.targetId && last && u.targetId !== last) switches++; if (u.targetId) last = u.targetId; }
    assert.ok(last && switches === 0, `${type}: holds one target under crossfire (${switches} switches in 20 s)`);
  } finally { Math.random = orig; }
}

// Fog: an enemy the side can't see, standing on the clicked spot, does not move where the squad ends.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const u = put(g, 0, 'rifle', 3, 50), e = put(g, 1, 'rifle', 76, 50);
  step(g);
  assert.ok(!g.players[0].visible.has(e.id));
  command(g, 0, { t: 'move', orders: [[u.id, 76, 50]] });
  assert.ok(Math.hypot(u.path.at(-1).x - 76, u.path.at(-1).z - 50) < 0.5, 'the squad heads for the exact spot');
}

// Stances govern the automatic moves (merged with PR #11). Hold position: no settling into cover after a move, no
// spreading out, no shift to cover or pull-back under fire. Hold fire: a rally walker does not stop to answer fire.
{
  const g = fresh(field(hedge)); g.players[0].mp = 5000;
  const held = put(g, 0, 'rifle', 10, 21); held.holdPos = true;
  command(g, 0, { t: 'move', orders: [[held.id, 35, 21]] });
  run(g, 8);
  assert.ok(Math.hypot(held.x - 35, held.z - 21) < 1, `Hold position: the squad stops where it was sent (${held.x}, ${held.z})`);
  const a = put(g, 0, 'rifle', 20, 50), b = put(g, 0, 'rifle', 20.5, 50); a.holdPos = b.holdPos = true;
  const shot = put(g, 0, 'rifle', 48, 15); shot.holdPos = true;
  Object.assign(shot, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 15 } });
  const tank = put(g, 0, 'tank', 60, 40); Object.assign(tank, { holdPos: true, rot: 0, hp: 100, hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 40 } });
  run(g, 4);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < CFG.behavior.spacing - 0.25, `Hold position: squads on top of each other only get pushed apart, they don't walk to the spacing (${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)} m)`);
  assert.ok(Math.hypot(shot.x - 48, shot.z - 15) < 0.5, 'Hold position: a squad under fire does not walk to the hedge');
  assert.ok(Math.hypot(tank.x - 60, tank.z - 40) < 0.5, 'Hold position: a hurt tank under fire does not pull back');
}
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const orig = Math.random;
  try {
    Math.random = () => 0.99; // misses only
    const u = put(g, 0, 'rifle', 10, 31), a = put(g, 1, 'rifle', 30, 45);
    u.holdFire = true; u.path = findPath(g, u, { x: 75, z: 31 }); u.drift = 'rally';
    command(g, 1, { t: 'attack', ids: [a.id], target: u.id });
    run(g, 2);
    assert.ok(!u.amove && !u.targetId && u.path.length && u.x > 15, 'Hold fire: the rally walker keeps walking and does not shoot back');
  } finally { Math.random = orig; }
}

// Hull facing (merged with PR #11): a tank fighting a squad turns its front to an anti-tank gun it can't see, and keeps
// it there between the gun's shots; rifle fire does not swing the hull.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const tank = put(g, 0, 'tank', 50, 20); Object.assign(tank, { rot: 0, hp: 1e5 });
  const squad = passive(put(g, 1, 'rifle', 70, 20)), gun = put(g, 1, 'at', 8, 20);
  passive(put(g, 1, 'rifle', 50, 55.5)); // a spotter just out of the tank's range, so the gun can see the tank
  gun.still = 10; squad.hp = 1e5;
  run(g, 4);
  let worst = 1;
  for (let i = 0; i < 8 * 20; i++) { step(g); worst = Math.min(worst, Math.cos(tank.rot - Math.PI)); }
  assert.equal(tank.targetId, squad.id, 'the tank fights the squad it can see');
  assert.ok(!g.players[0].visible.has(gun.id), 'and cannot see the gun');
  assert.ok(worst > 0.95, `its front stays on the gun across reloads (worst cos ${worst.toFixed(2)})`);
  const h = fresh(field()); h.players[0].mp = h.players[1].mp = 5000;
  const quiet = put(h, 0, 'tank', 40, 20); Object.assign(quiet, { rot: 0, hp: 1e5, holdFire: true });
  put(h, 1, 'rifle', 40, 32);
  run(h, 3);
  assert.ok(Math.cos(quiet.rot) > 0.99, 'a tank shot at by rifles keeps its hull where it was');
}

// Take Cover (merged with PR #11) uses the same spot rule as the rest: squads spread to the spacing when the cover has
// room for it, else one squad to a cell.
{
  const g = fresh(field(hedge)); g.players[0].mp = 5000;
  const squads = [21, 22, 23].map(z => put(g, 0, 'rifle', 46, z));
  assert.equal(command(g, 0, { t: 'cover', ids: squads.map(u => u.id) }), undefined);
  run(g, 4);
  const gaps = squads.flatMap((p, i) => squads.slice(i + 1).map(q => Math.hypot(p.x - q.x, p.z - q.z)));
  assert.ok(squads.every(u => covered(g, u)), 'every squad reaches the hedge');
  assert.ok(Math.min(...gaps) >= CFG.behavior.spacing - 0.25, `spread along it (closest pair ${Math.min(...gaps).toFixed(2)} m)`);
}

// A waiting order does not wait for a step a squad took on its own: shift-queued during a shift into cover, it starts.
{
  const g = fresh(field(hedge)); g.players[0].mp = 5000;
  const u = put(g, 0, 'rifle', 46, 21);
  Object.assign(u, { hitBy: 0, hitAt: g.tick, hitFrom: { x: 78, z: 21 } });
  step(g);
  assert.equal(u.drift, 'cover', 'the squad sets off for the hedge on its own');
  command(g, 0, { t: 'move', orders: [[u.id, 60, 40]], queue: true });
  step(g);
  assert.ok(!u.drift && !u.orders.length && Math.hypot(u.path.at(-1).x - 60, u.path.at(-1).z - 40) < 4, 'the queued move takes over at once');
  // only the first waiting order starts: a queued garrison is not overwritten by the move queued behind it
  const h = fresh(field(r => { hedge(r); r[10][30] = r[10][31] = 'B'; })); h.players[0].mp = 5000;
  const v = put(h, 0, 'rifle', 46, 21);
  Object.assign(v, { hitBy: 0, hitAt: h.tick, hitFrom: { x: 78, z: 21 } });
  step(h);
  assert.equal(v.drift, 'cover');
  command(h, 0, { t: 'garrison', ids: [v.id], x: 61, z: 21, queue: true });
  command(h, 0, { t: 'move', orders: [[v.id, 60, 40]], queue: true });
  step(h);
  assert.ok(v.enter >= 0 && v.orders.length === 1, 'the garrison order starts and the move waits behind it');
}

// Squads sent one at a time to the same spot from far away still end apart (a path's end holds its spot wherever the
// squad is now).
{
  const g = fresh(field()); g.players[0].mp = 5000;
  const a = put(g, 0, 'rifle', 5, 5), b = put(g, 0, 'rifle', 5, 15);
  command(g, 0, { t: 'move', orders: [[a.id, 70, 50]] });
  command(g, 0, { t: 'move', orders: [[b.id, 70, 50]] });
  const gap = Math.hypot(a.path.at(-1).x - b.path.at(-1).x, a.path.at(-1).z - b.path.at(-1).z);
  assert.ok(gap >= CFG.behavior.spacing, `separate orders to one spot end ${gap.toFixed(2)} m apart`);
}

// Spacing at a crowded move destination still prefers shelter over a closer open cell.
{
  const g = fresh(field(r => { r[10][20] = '#'; r[12][20] = '#'; })); g.points = [];
  g.players[0].mp = 5000;
  const holder = put(g, 0, 'rifle', 41, 21); holder.holdPos = true;
  const moving = put(g, 0, 'rifle', 5, 21);
  command(g, 0, { t: 'move', orders: [[moving.id, 41, 21]] });
  const end = moving.path.at(-1);
  assert.ok(end && covered(g, end), 'a crowded covered destination retains cover');
  assert.ok(Math.hypot(end.x - holder.x, end.z - holder.z) >= CFG.behavior.spacing, 'the covered destination has room for the squad');
}

// Formation facing validation.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const a = put(g, 0, 'rifle', 10, 20), b = put(g, 0, 'tank', 10, 35);
  assert.equal(a.face, null, 'new units have no ordered facing');
  command(g, 0, { t: 'move', orders: [[a.id, 30, 20], [b.id, 30, 35]] });
  command(g, 0, { t: 'move', orders: [[a.id, 50, 20], [b.id, 50, 35]], queue: true });
  for (const face of [NaN, Infinity, '1', {}, null]) for (const t of ['move', 'amove']) for (const queue of [false, true]) {
    const before = structuredClone([...g.units.values()]);
    assert.equal(command(g, 0, { t, orders: [[a.id, 60, 20], [b.id, 60, 35]], face, queue }), 'blocked', 'invalid facing refuses the whole command');
    assert.deepEqual([...g.units.values()], before, 'invalid facing leaves every unit untouched');
    assert.equal(normalizeFace(face), null, 'invalid facing has no normalized angle');
  }
  for (const face of [7, -7]) {
    assert.equal(command(g, 0, { t: 'move', orders: [[a.id, 30, 20], [b.id, 30, 35]], face }), undefined);
    const expected = Math.atan2(Math.sin(face), Math.cos(face));
    for (const u of [a, b]) {
      assert.equal(u.face.a, expected, 'finite facing is normalized');
      assert.ok(u.face.a > -Math.PI && u.face.a <= Math.PI, 'stored facing is inside the angle range');
    }
  }
  command(g, 0, { t: 'move', orders: [[a.id, 30, 20], [b.id, 30, 35]] });
  assert.equal(a.face, null, 'a move without facing leaves infantry with no facing');
  assert.equal(b.face, null, 'a move without facing leaves vehicles with no facing');
  const plane = put(g, 0, 'attacker', 20, 50);
  command(g, 0, { t: 'move', orders: [[plane.id, 60, 50]], face: 7 });
  assert.equal(plane.face, null, 'aircraft ignore the ordered facing');
  assert.deepEqual(plane.air.mission, { kind: 'patrol', x: 60, z: 50 }, 'aircraft keep the patrol order');
  const row = snapshotFor(g, 0, []).units.find(v => v[0] === a.id);
  assert.equal(row.length, 15, 'facing does not add a unit snapshot field');
  assert.deepEqual(snapshotFor(g, 0, [], [], snapshotCache(g)).units, snapshotFor(g, 0, []).units, 'facing keeps cached and uncached unit snapshots equal');
}

// Formation facing arrival and hull turning.
{
  const face = Math.PI / 2;
  for (const type of ['rifle', 'mg', 'tank']) {
    const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
    const u = put(g, 0, type, 10, 20); u.rot = 0;
    command(g, 0, { t: 'move', orders: [[u.id, 30, 20]], face });
    let movingRot = u.rot, ticks = 0;
    while (u.path.length && ticks++ < 400) { movingRot = u.rot; step(g); }
    assert.ok(!u.path.length && Math.hypot(u.x - 30, u.z - 20) < 0.5, `${type}: reaches the facing destination`);
    step(g);
    assert.deepEqual(u.face, { a: face, x: 30, z: 20 }, `${type}: keeps the ordered end spot`);
    if (type === 'tank') {
      assert.ok(Math.abs(normalizeFace(u.rot - face)) > 0.5, 'the hull does not turn to its facing instantly');
      assert.ok(Math.abs(normalizeFace(u.rot - movingRot)) <= CFG.behavior.hullTurn / 20 + 1e-9, 'the hull turns at the configured speed on arrival');
      run(g, Math.PI / CFG.behavior.hullTurn + 1);
      assert.ok(Math.abs(normalizeFace(u.rot - face)) < 1e-9, 'the hull finishes turning within its turn time');
    } else assert.equal(u.rot, face, `${type}: faces the order on arrival`);
    assert.equal(u.aim, u.rot, `${type}: an idle unit aims along its facing`);
    if (type === 'mg') { run(g, UNITS.mg.w.setup); assert.ok(u.still >= UNITS.mg.w.setup, 'an arrived MG crew sets up while holding its facing'); }
  }
}

// Formation facing target and incoming fire priority.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = g.players[1].mp = 10000;
  const tank = put(g, 0, 'tank', 40, 20); tank.cooldown = 1e9;
  command(g, 0, { t: 'move', orders: [[tank.id, 40, 20]], face: 0 });
  const enemy = put(g, 1, 'tank', 40, 45); enemy.holdFire = true;
  run(g, 2);
  assert.equal(tank.targetId, enemy.id, 'a tank still acquires a target while holding a facing');
  assert.ok(Math.abs(normalizeFace(tank.rot - Math.PI / 2)) < 1e-9, 'the target takes priority over ordered facing');
  Object.assign(tank, { hitAt: g.tick, hitFrom: { x: 5, z: 20 } });
  run(g, 0.2);
  assert.ok(Math.abs(normalizeFace(tank.rot - Math.PI / 2)) < 1e-9, 'the target also takes priority over incoming fire');
  g.units.delete(enemy.id);
  run(g, 0.2);
  assert.ok(tank.rot > Math.PI / 2, 'recent incoming fire takes priority after the target disappears');
  assert.equal(tank.face.a, 0, 'combat preserves the ordered facing');
  run(g, CFG.behavior.threatTime + Math.PI / CFG.behavior.hullTurn + 1);
  assert.ok(Math.abs(normalizeFace(tank.rot)) < 1e-9, 'the tank returns to its facing after combat and incoming fire end');
}

// Formation facing exact spots and crowding.
{
  const rows = Array(40).fill('.'.repeat(40)); rows[10] = '.'.repeat(20) + '#' + '.'.repeat(19); rows[15] = rows[10];
  const g = fresh(rows); g.players[0].mp = 10000;
  const a = put(g, 0, 'rifle', 10, 21), b = put(g, 0, 'rifle', 10, 31);
  command(g, 0, { t: 'move', orders: [[a.id, 37, 21], [b.id, 37, 31]], face: 0 });
  assert.deepEqual(a.path.at(-1), { x: 37, z: 21 }, 'a facing spot near a wall keeps its exact position');
  assert.deepEqual(b.path.at(-1), { x: 37, z: 31 }, 'distinct facing spots keep their layout');
  run(g, 10);
  assert.ok(Math.hypot(a.x - 37, a.z - 21) < 0.5 && Math.hypot(b.x - 37, b.z - 31) < 0.5, 'infantry arrive at the supplied facing spots');
  const plain = fresh(rows); plain.players[0].mp = 10000;
  const squad = put(plain, 0, 'rifle', 10, 21);
  command(plain, 0, { t: 'move', orders: [[squad.id, 37, 21]] });
  assert.notDeepEqual(squad.path.at(-1), { x: 37, z: 21 }, 'a plain move still finds nearby cover');
  run(plain, 10);
  assert.ok(sim.inCover(plain, squad) || squad.x > 37, 'a plain move still settles at the wall');
  const crowded = fresh(rows); crowded.players[0].mp = 10000;
  const held = put(crowded, 0, 'rifle', 37, 21), incoming = put(crowded, 0, 'rifle', 10, 21);
  command(crowded, 0, { t: 'move', orders: [[incoming.id, 37, 21]], face: 0 });
  const end = incoming.path.at(-1);
  assert.ok(Math.hypot(end.x - held.x, end.z - held.z) >= CFG.behavior.spacing, 'an occupied facing spot shifts to a free one');
  assert.deepEqual(incoming.face, { a: 0, ...end }, 'facing records the free end spot after crowding');
}

// Formation facing shared spots and pure layout.
{
  const rifleSize = slotSize(UNITS.rifle), tankSize = slotSize(UNITS.tank), face = 0.7, at = { x: 100, z: 100 };
  assert.ok(tankSize > rifleSize, 'a tank takes more frontage than a rifle squad');
  assert.equal(slotSize({ radius: 0, infantry: true }), CFG.behavior.spacing, 'small infantry keep the infantry spacing minimum');
  assert.equal(slotSize({ radius: 0, infantry: false }), CFG.behavior.vehicleSpacing, 'small vehicles keep the vehicle spacing minimum');
  const items = [{ id: 1, x: 15, z: 20, size: rifleSize }, { id: 2, x: 5, z: 5, size: tankSize }, { id: 3, x: 10, z: 10, size: rifleSize }], saved = structuredClone(items);
  const natural = items.reduce((n, u) => n + u.size, 0), sizeById = new Map(items.map(u => [u.id, u.size]));
  const width = spots => { const p = spots[0], q = spots.at(-1); return Math.hypot(q[1] - p[1], q[2] - p[2]) + (sizeById.get(p[0]) + sizeById.get(q[0])) / 2; };
  const spots = facingSpots(items, at, face, 0), f = { x: Math.cos(face), z: Math.sin(face) };
  assert.deepEqual(facingSpots(items, at, face, 0), spots, 'the same input gives the same facing spots');
  assert.deepEqual(items, saved, 'formation layout leaves the input unchanged');
  for (let i = 1; i < spots.length; i++) {
    const p = spots[i - 1], q = spots[i], dx = q[1] - p[1], dz = q[2] - p[2];
    assert.ok(Math.abs(dx * f.x + dz * f.z) < 1e-9, 'the formation line is perpendicular to its facing');
    assert.ok(Math.hypot(dx, dz) >= (sizeById.get(p[0]) + sizeById.get(q[0])) / 2 - 1e-9, 'mixed unit slots do not overlap');
    const a = items.find(u => u.id === p[0]), b = items.find(u => u.id === q[0]);
    assert.ok(-a.x * f.z + a.z * f.x <= -b.x * f.z + b.z * f.x, 'units keep their left to right order');
  }
  assert.ok(Math.abs(width(spots) - natural) < 1e-9, 'a short drag keeps the natural frontage');
  assert.ok(Math.abs(width(facingSpots(items, at, face, 2 * natural)) - 2 * natural) < 1e-9, 'a longer drag widens the frontage');
  assert.ok(Math.abs(width(facingSpots(items, at, face, 10 * natural)) - 3 * natural) < 1e-9, 'frontage stops widening at three times its natural width');
  const many = Array.from({ length: 23 }, (_, i) => ({ id: i, x: 0, z: i * 10, size: i % 3 === 0 ? tankSize : rifleSize }));
  const ranks = new Map();
  for (const spot of facingSpots(many, at, 0, 0)) { const depth = spot[1] - at.x; if (!ranks.has(depth)) ranks.set(depth, []); ranks.get(depth).push(spot); }
  const depths = [...ranks.keys()].sort((a, b) => b - a);
  assert.equal(depths.length, 3, 'more than ten units form several ranks');
  assert.equal(depths[0], 0, 'the first rank centers on the press point');
  assert.ok(depths.slice(1).every(d => d < 0) && [...ranks.values()].every(rank => rank.length <= 10), 'later ranks stand behind the front rank and hold at most ten units');
  for (let i = 1; i < depths.length; i++) assert.ok(depths[i - 1] - depths[i] > Math.max(...ranks.get(depths[i - 1]).map(s => many[s[0]].size)), 'ranks leave the deepest slot above them clear');
  const g = fresh(Array(60).fill('.'.repeat(60))); g.players[0].mp = 10000;
  const squads = Array.from({ length: 4 }, (_, i) => put(g, 0, 'rifle', 10, 15 + i * 6));
  command(g, 0, { t: 'move', orders: squads.map(u => [u.id, 60, 50]), face: 0 });
  const ends = squads.map(u => u.path.at(-1)).sort((a, b) => a.z - b.z);
  assert.ok(ends.every(p => Math.abs(p.x - 60) < 1e-9), 'units sharing a facing spot line up perpendicular to the facing');
  for (let i = 1; i < ends.length; i++) assert.ok(ends[i].z - ends[i - 1].z >= rifleSize - 1e-9, 'shared facing spots keep a full slot between neighbours');
}

// Formation shapes, rear ranks, spacing, a wide drag, and marching together.
{
  const at = { x: 100, z: 100 }, size = slotSize(UNITS.rifle);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, x: 100 + (i - 4) * 4, z: 60, size }));
  const depths = (spots) => new Set(spots.map(s => (s[2] - at.z).toFixed(3))).size; // face +z: depth runs along z
  const face = Math.PI / 2;
  assert.equal(depths(facingSpots(nine, at, face, 0)), 1, 'a line of nine is one rank');
  assert.equal(depths(facingSpots(nine, at, face, 0, { shape: 'block' })), 3, 'a block of nine is three ranks');
  assert.equal(depths(facingSpots(nine, at, face, 0, { shape: 'column' })), 5, 'a column of nine is two files deep');
  assert.equal(depths(facingSpots(nine, at, face, 0, { shape: 'wedge' })), 4, 'a wedge of nine has ranks of 1, 2, 3, 3');
  const wedge = facingSpots(nine, at, face, 0, { shape: 'wedge' });
  assert.equal(wedge.filter(s => Math.abs(s[2] - at.z) < 1e-9).length, 1, 'one unit at the tip of the wedge');
  const thirty = Array.from({ length: 30 }, (_, i) => ({ id: i, x: i, z: 0, size }));
  assert.equal(depths(facingSpots(thirty, at, face, 0)), 3, 'thirty in a short drag stand three deep');
  assert.equal(depths(facingSpots(thirty, at, face, 15 * size)), 2, 'a wider drag fits more side by side, so fewer ranks');
  const mixed = nine.map((u, i) => ({ ...u, back: i < 2 }));
  const spots = facingSpots(mixed, at, face, 0, { shape: 'block' }), rear = Math.min(...spots.map(s => s[2]));
  assert.ok(spots.filter(s => s[0] <= 2).every(s => s[2] === rear), 'mortars and medics take the rear rank');
  const width = (sp) => Math.max(...sp.map(s => s[1])) - Math.min(...sp.map(s => s[1]));
  assert.ok(width(facingSpots(nine, at, face, 0, { spread: 2 })) > width(facingSpots(nine, at, face, 0)) * 1.5, 'Spread widens the gaps');
  // march together: the light tank waits for the AT gun's pace until it arrives
  const g = fresh(Array(60).fill('.'.repeat(60))); g.players[0].mp = 10000;
  const tank = put(g, 0, 'tank', 10, 20), gun = put(g, 0, 'at', 10, 30);
  command(g, 0, { t: 'move', orders: [[tank.id, 90, 20], [gun.id, 90, 30]], together: true });
  assert.equal(tank.pace, UNITS.at.speed, 'the group marches at its slowest unit');
  for (let i = 0; i < 20; i++) step(g);
  assert.ok(Math.abs((tank.x - 10) - (gun.x - 10)) < 2, 'tank and gun stay level on the march');
  command(g, 0, { t: 'move', orders: [[tank.id, 90, 20]] });
  assert.equal(tank.pace, 0, 'a plain order drops the march pace');
  console.log('formation shapes, ranks, spacing and marching together checked');
}

// Formation facing queued orders.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 10, 20), face = 1.1;
  command(g, 0, { t: 'move', orders: [[u.id, 30, 20]] });
  command(g, 0, { t: 'move', orders: [[u.id, 50, 20]], face, queue: true });
  assert.equal(u.face, null, 'a queued facing does not change the first leg');
  assert.equal(u.orders[0].face, normalizeFace(face), 'the waiting move stores its facing');
  run(g, 1);
  assert.ok(u.x < 30 && u.path.length && u.face === null, 'the first leg continues without a facing');
  let ticks = 0; while (u.orders.length && ticks++ < 400) step(g);
  assert.deepEqual(u.path.at(-1), { x: 50, z: 20 }, 'the queued move starts its second leg');
  assert.equal(u.face.a, normalizeFace(face), 'queue replay restores the facing');
  run(g, 10);
  assert.ok(!u.path.length && Math.hypot(u.x - 50, u.z - 20) < 0.5, 'the queued facing move reaches its spot');
  assert.equal(u.rot, normalizeFace(face), 'the second leg finishes with the queued facing');
  command(g, 0, { t: 'move', orders: [[u.id, 30, 20]], face: Math.PI / 2 });
  command(g, 0, { t: 'move', orders: [[u.id, 10, 20]], queue: true });
  assert.equal(u.face.a, Math.PI / 2, 'queueing a plain move keeps the current facing until replay');
  ticks = 0; while (u.orders.length && ticks++ < 400) step(g);
  assert.equal(u.face, null, 'a queued move without facing clears the previous facing on replay');
  run(g, 10);
  assert.ok(Math.hypot(u.x - 10, u.z - 20) < 0.5 && u.face === null, 'the queued plain move finishes without an old facing');
  const group = fresh(Array(60).fill('.'.repeat(60))); group.players[0].mp = 10000;
  const squads = Array.from({ length: 3 }, (_, i) => put(group, 0, 'rifle', 10, 20 + i * 7));
  command(group, 0, { t: 'move', orders: squads.map((u, i) => [u.id, 30, 20 + i * 7]), face: 0.4 });
  const current = structuredClone(squads.map(u => [u.path, u.face]));
  command(group, 0, { t: 'move', orders: squads.map(u => [u.id, 60, 45]), face: 0, queue: true });
  assert.deepEqual(squads.map(u => [u.path, u.face]), current, 'queueing a shared facing spot keeps the current moves and facings');
  const waiting = squads.map(u => ({ id: u.id, x: u.orders[0].x, z: u.orders[0].z })).sort((a, b) => a.z - b.z);
  assert.ok(waiting.every(p => p.x === 60), 'queued shared facing spots form a perpendicular line');
  for (let i = 1; i < waiting.length; i++) assert.ok(waiting[i].z - waiting[i - 1].z >= slotSize(UNITS.rifle), 'queued shared facing spots keep distinct slots');
  run(group, 20);
  for (const p of waiting) {
    const squad = group.units.get(p.id);
    assert.ok(!squad.path.length && Math.hypot(squad.x - p.x, squad.z - p.z) < 0.5, 'a queued formation reaches its stored slot');
    assert.equal(squad.rot, 0, 'a queued formation finishes with its stored facing');
  }
}

// Formation facing attack-move arrival.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = 10000;
  const u = put(g, 0, 'rifle', 10, 20), face = -1.2;
  command(g, 0, { t: 'amove', orders: [[u.id, 40, 20]], face });
  run(g, 12);
  assert.ok(!u.path.length && !u.amove && Math.hypot(u.x - 40, u.z - 20) < 0.5, 'an attack-move with facing completes its move');
  assert.equal(u.rot, normalizeFace(face), 'an attack-move applies facing after arrival');
}

// Formation facing retreat and replacement orders.
{
  const g = fresh(Array(40).fill('.'.repeat(40))); g.players[0].mp = g.players[1].mp = 10000;
  const u = put(g, 0, 'rifle', 40, 20), face = Math.PI / 2;
  g.players[0].spawn = { x: 3, z: 20 };
  command(g, 0, { t: 'move', orders: [[u.id, u.x, u.z]], face }); step(g);
  assert.equal(u.rot, face, 'the squad first holds its ordered facing');
  command(g, 0, { t: 'retreat', ids: [u.id] });
  assert.equal(u.face, null, 'retreat drops the ordered facing');
  run(g, 0.5);
  assert.ok(u.retreating && Math.cos(u.rot) < -0.9 && u.face === null, 'a retreating squad runs home without turning to its old facing');
  command(g, 0, { t: 'move', orders: [[u.id, u.x, u.z]], face }); step(g);
  command(g, 0, { t: 'move', orders: [[u.id, 50, 20]] });
  assert.equal(u.face, null, 'a plain move drops the old facing');
  command(g, 0, { t: 'move', orders: [[u.id, u.x, u.z]], face }); step(g);
  command(g, 0, { t: 'stop', ids: [u.id] });
  assert.equal(u.face, null, 'Stop drops the old facing');
  command(g, 0, { t: 'move', orders: [[u.id, u.x, u.z]], face });
  const enemy = put(g, 1, 'rifle', 55, 20); enemy.holdFire = true; u.cooldown = 1e9;
  run(g, 0.3);
  assert.equal(command(g, 0, { t: 'attack', ids: [u.id], target: enemy.id }), undefined);
  assert.equal(u.face, null, 'an attack order drops the old facing');
}

// Formation facing client dispatch.
{
  const ground = { x: 35, z: 25 }, face = 0.8, reach = 22;
  const make = (types = ['rifle', 'tank']) => {
    const units = new Map(types.map((type, i) => [i + 1, { id: i + 1, owner: 0, type, x: 10, z: 10 + i * 8 }])), sent = [], calls = [], feedback = [];
    const ctx = { selected: new Set(units.keys()), units, me: 0, defs: UNITS, diggers: ['rifle', 'conscript', 'engineer'], moveColor: 0x6fa8f0,
      formation: (...args) => { calls.push(args); return args[0].map((u, i) => [u.id, args[1].x, args[1].z + i * 8]); }, send: cmd => sent.push(cmd), feedback: (...args) => feedback.push(args) };
    return { ctx, sent, calls, feedback, orders: createOrders(ctx) };
  };
  const plain = make();
  assert.equal(plain.orders.wouldMove({ ground }), true, 'plain ground clicks can start a facing gesture');
  plain.orders.dispatch({ ground }, {});
  const ordinary = { t: 'move', orders: [[1, 35, 25], [2, 35, 33]], queue: false };
  assert.equal(JSON.stringify(plain.sent[0]), JSON.stringify(ordinary), 'a plain click sends the same command bytes');
  assert.equal(plain.calls[0].length, 2, 'a plain click keeps the original formation call');
  assert.deepEqual(plain.feedback[0], [ground, plain.ctx.moveColor, 660, 'move'], 'a plain click keeps its feedback');
  const shift = make(); shift.orders.dispatch({ ground }, { shiftKey: true });
  assert.equal(JSON.stringify(shift.sent[0]), JSON.stringify({ ...ordinary, queue: true }), 'a plain Shift click keeps the same queued command bytes');
  const faced = make(); faced.orders.dispatch({ ground }, { shiftKey: true }, { face, reach });
  assert.deepEqual(faced.sent[0], { ...ordinary, face, queue: true }, 'facing moves include the angle and queue flag');
  assert.deepEqual(faced.calls[0], [[...faced.ctx.units.values()], ground, face, reach], 'facing dispatch gives the angle and reach to formation');
  for (const [event, options] of [[{ ctrlKey: true }, { face, reach }], [{}, { attack: true, face, reach }]]) {
    const a = make(); a.orders.dispatch({ ground }, event, options);
    assert.equal(a.sent[0].t, 'amove', 'Ctrl and attack mode produce attack-move');
    assert.equal(a.sent[0].face, face, 'attack-move dispatch includes facing');
  }
  const invalid = make(); invalid.orders.dispatch({ ground }, {}, { face: NaN, reach });
  assert.deepEqual(invalid.sent[0], ordinary, 'a non-finite client facing leaves a plain move');
  const cases = [
    { types: ['rifle'], cursor: { ground, enemy: { id: 9, x: 40, z: 25 } }, t: 'attack' },
    { types: ['rifle'], cursor: { ground, house: { x: 31, z: 21 } }, t: 'garrison' },
    { types: ['rifle'], cursor: { ground, friend: { id: 9, owner: 0, type: 'halftrack' } }, t: 'board' },
    { types: ['fighter'], cursor: { ground, friend: { id: 9, x: 40, z: 25 } }, t: 'escort' },
    { types: ['engineer'], cursor: { ground, building: { id: 9, type: 'barracks', built: 0, hp: 1, x: 40, z: 25 } }, t: 'assist' },
    { types: ['rifle'], cursor: { ground, works: 9 }, t: 'entrench' },
    { types: ['barracks'], cursor: { ground }, t: 'rally' }
  ];
  for (const { types, cursor, t } of cases) {
    const a = make(types);
    assert.equal(a.orders.wouldMove(cursor), false, `${t}: the special order dispatches without a facing gesture`);
    a.orders.dispatch(cursor, {}, { face, reach });
    assert.equal(a.sent[0].t, t, `${t}: keeps its order kind`);
    assert.ok(!Object.hasOwn(a.sent[0], 'face'), `${t}: ignores facing`);
    assert.equal(a.calls.length, 0, `${t}: does not request a facing formation`);
  }
  const mixed = make(['rifle', 'barracks']); mixed.orders.dispatch({ ground }, { shiftKey: true }, { face, reach });
  assert.equal(mixed.sent[0].t, 'orders', 'troops and a production building keep their command group');
  assert.equal(mixed.sent[0].queue, true, 'a grouped facing dispatch queues both orders');
  assert.equal(mixed.sent[0].commands[0].face, face, 'a grouped ground move includes its facing');
  assert.ok(!Object.hasOwn(mixed.sent[0].commands[1], 'face'), 'the grouped rally ignores facing');
}

// A copy of shared/sim.js loaded from a data: URL (to reach its internals). Its relative imports (story.js, grid.js)
// point at the real files, so the copy shares those modules with the normal import.
const simCopy = (source) => import('data:text/javascript;base64,' + Buffer.from(source.replace(/from '\.\/([\w-]+\.js)'/g, (_, file) => `from '${new URL(`./shared/${file}`, import.meta.url)}'`)).toString('base64'));
// Fixed Massive fixture for exact comparisons and repeatable subsystem timings.
const massiveInternals = await simCopy(readFileSync('shared/sim.js', 'utf8')
  + '\nexport { updateVision, nearCover, behindCover, aimPoint, flagsAt, dist, spawnUnit, placeBuilding, wreckBuilding, setCell, logCell, pickTarget };');
// Salvo target clusters use visible squads only, so hidden neighbors cannot change automatic target choice.
{
  const g = fresh(field()); g.players[0].mp = g.players[1].mp = 5000;
  const mortar = put(g, 0, 'mortar', 10, 30);
  const left = put(g, 1, 'rifle', 40, 15), right = put(g, 1, 'rifle', 40, 45);
  g.players[0].visible = new Set([left.id, right.id]); snapshotCache(g);
  const before = massiveInternals.pickTarget(g, mortar);
  assert.equal(before, left.id, 'equal visible clusters keep the first target');
  const hidden = put(g, 1, 'rifle', 41, 45); snapshotCache(g);
  assert.equal(massiveInternals.pickTarget(g, mortar), before, 'an unseen squad near another target changes nothing');
  g.players[0].visible.add(hidden.id);
  assert.equal(massiveInternals.pickTarget(g, mortar), right.id, 'a visible cluster can change the target');
  hidden.riding = 123;
  assert.equal(massiveInternals.pickTarget(g, mortar), before, 'a passenger cannot enlarge a salvo target cluster');
}

const massiveFixture = () => {
  const map = JSON.parse(readFileSync('maps/six-fronts.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c', 'd', 'e', 'f'], false, [0, 1, 2, 3, 4, 5], [0, 1, 2, 0, 1, 2], { mode: 'classic', army: 'massive' });
  for (let i = 0; i < 73; i++) {
    const c = (10 + Math.floor(i / 13) * 22) * g.w + 10 + i % 13 * 10;
    const b = massiveInternals.placeBuilding(g, i % 6, 'barracks', c, true);
    if (i % 3 !== 0) { massiveInternals.wreckBuilding(g, b); g.units.delete(b.id); }
  }
  const types = ['rifle', 'mg', 'tank', 'at', 'mortar', 'sniper', 'fighter', 'conscript'];
  for (let i = 0; g.units.size < 300; i++) {
    const owner = i % 6, u = massiveInternals.spawnUnit(g, owner, types[Math.floor(i / 6) % types.length]), p = g.players[owner].spawn;
    Object.assign(u, { x: p.x + (Math.floor(i / 6) % 10 - 4.5) * 4, z: p.z + Math.floor(i / 60) * 4, cooldown: 1e9, still: 5, shotAt: -1000 });
    if (u.air) Object.assign(u.air, { state: ['base', 'out', 'station', 'home'][owner % 4], mission: { kind: 'patrol', x: p.x, z: p.z } });
  }
  const houses = g.chars.flatMap((ch, c) => ch === 'B' ? [c] : []);
  for (let owner = 0; owner < 6; owner++) {
    const u = [...g.units.values()].find(u => u.owner === owner && u.type === 'rifle'), c = houses[owner * 3];
    Object.assign(u, { garrison: c, x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL });
  }
  for (let c = 0; g.cellLog.length < 1075; c++) if (!g.cellLogIndexes.has(c)) massiveInternals.setCell(g, c, g.chars[c]);
  g.tick = 101; g.shots = []; g.newCells = [];
  g.strikes.push({ kind: 'recon', owner: 0, x: g.w * CELL / 2, z: g.h * CELL / 2, dir: 0, t: 0, left: SUPPORT.recon.dur, next: 0, live: true });
  return g;
};

// Reference before range-gated aim points and team-level vision preparation.
const referenceVision = g => {
  const { dist, airborne, aimPoint, levelAt, los, inStrip } = massiveInternals;
  const byTeam = new Map();
  for (const p of g.players) {
    if (byTeam.has(p.team)) { p.visible = byTeam.get(p.team); continue; }
    const vis = new Set(), own = [...g.units.values()].filter(u => g.players[u.owner].team === p.team);
    for (const t of g.units.values()) {
      if (g.players[t.owner].team === p.team) continue;
      if (UNITS[t.type].structure && !UNITS[t.type].building) { vis.add(t.id); continue; }
      if (t.air) { if (airborne(t) && own.some(u => (!u.air || airborne(u)) && dist(u, t) <= CFG.air.seeRange)) vis.add(t.id); continue; }
      const aim = t.cells ? null : t;
      const hidden = UNITS[t.type].camo && t.still >= 3 && g.tick - (t.shotAt ?? -1e9) >= 80;
      if (own.some(u => { const d = dist(u, t), at = aim ?? aimPoint(g, u, t); if (u.air) return airborne(u) && d <= UNITS[u.type].vision && (!hidden || d < CFG.camoRange * 2); if (hidden) return d < CFG.camoRange; return d < 6 || (UNITS[u.type].building && d <= UNITS[u.type].vision) || (d <= UNITS[u.type].vision * (1 + CFG.highGroundVision * levelAt(g, u.x, u.z)) * (u.garrison >= 0 ? CFG.garrisonVision : 1) && los(g, u, at)); })
        || g.strikes.some(s => s.live && s.kind === 'recon' && g.players[s.owner].team === p.team && inStrip(s, t, SUPPORT.recon.len, SUPPORT.recon.width))) vis.add(t.id);
    }
    byTeam.set(p.team, p.visible = vis);
    if (g.mode?.kind !== 'classic') continue;
    const mem = (g.ghosts ??= new Map()).get(p.team) ?? new Map();
    g.ghosts.set(p.team, mem);
    for (const id of vis) { const t = g.units.get(id); if (UNITS[t.type].building) mem.set(id, { id, type: t.type, owner: t.owner, x: t.x, z: t.z, built: t.built }); }
    for (const [id, gh] of mem) if (!vis.has(id) && !g.units.has(id) && own.some(u => (!u.air || airborne(u)) && dist(u, gh) <= UNITS[u.type].vision && (u.air || UNITS[u.type].building || los(g, u, gh) || dist(u, gh) < 8))) mem.delete(id);
  }
};

// Massive vision preserves visible sets and Ghosts across ground, air, camouflage, garrisons and recon.
{
  const g = massiveFixture();
  assert.equal(g.units.size, 300, 'fixed Massive fixture has 300 units');
  assert.equal(new Set([...g.buildingCells.values()].map(b => b.id)).size, 79, 'fixture remembers 79 placed buildings');
  assert.equal(g.cellLog.length, 1075, 'fixture has 1075 latest terrain entries');
  for (let round = 0; round < 8; round++) {
    if (round === 2) g.players.forEach((p, i) => { p.team = Math.floor(i / 2); });
    if (round === 4) { const b = [...g.units.values()].find(u => UNITS[u.type].building && u.owner === 1); g.units.delete(b.id); }
    for (const u of g.units.values()) {
      if (u.air) u.air.state = ['base', 'out', 'station', 'home', 'rearm'][(u.owner + round) % 5];
      if (UNITS[u.type].camo) { u.still = round % 2 ? 5 : 0; u.shotAt = round % 3 ? -1000 : g.tick; }
    }
    const expected = structuredClone(g);
    referenceVision(expected); massiveInternals.updateVision(g);
    assert.deepEqual(g.players.map(p => p.visible), expected.players.map(p => p.visible), `vision sets match the old function in round ${round}`);
    assert.deepEqual(g.ghosts, expected.ghosts, `Ghost memory matches the old function in round ${round}`);
    g.tick += 4;
  }
}

// The fog mask a team is sent is its vision and nothing more: updateVision's rule at every cell centre (the public los
// and plain Math.hypot here), the live recon corridors and the cells under the enemy ground units the team sees. The
// packed keyframe and deltas rebuild it on each client. Units standing still keep their cells between passes, so the
// check runs again after a hedge, a smoke cloud and a raised patch of ground appear inside one unit's view.
// the match weather's own sight (shared/weather.js); Rain cuts sight through the sim's rain (g.wx) instead
const WEATHER_SIGHT = { clear: 1, fog: 0.7, mud: 1, snow: 0.9, rain: 1 };
const fogSees = (g, u, at) => {
  const def = UNITS[u.type], d = Math.hypot(u.x - at.x, u.z - at.z);
  if (u.air) return d <= def.vision;
  const sight = def.vision * (WEATHER_SIGHT[g.weather?.now] ?? 1), range = sight * (1 + CFG.highGroundVision * massiveInternals.levelAt(g, u.x, u.z)) * (u.garrison >= 0 ? CFG.garrisonVision : 1) * (1 - CFG.weather.sight * (g.wx?.rain ?? 0));
  return d < 6 || (!!def.building && d <= sight) || (d <= range && los(g, u, at));
};
const fogEyes = (g, team) => [...g.units.values()].filter(u => g.players[u.owner].team === team && (!u.air || massiveInternals.airborne(u)));
const cellAt = (g, c) => ({ x: (c % g.w + 0.5) * CELL, z: (Math.floor(c / g.w) + 0.5) * CELL });
const underSeen = (g, team) => [...g.players.find(p => p.team === team).visible].flatMap(id => {
  const t = g.units.get(id);
  return !t || t.air ? [] : t.cells ? [...t.cells] : [Math.floor(t.z / CELL) * g.w + Math.floor(t.x / CELL)];
});
const reconOver = (g, team, at) => g.strikes.some(s => s.live && s.kind === 'recon' && g.players[s.owner].team === team && massiveInternals.inStrip(s, at, SUPPORT.recon.len, SUPPORT.recon.width));
const referenceFog = (g, team) => {
  const vis = new Uint8Array(g.w * g.h);
  for (const u of fogEyes(g, team)) {
    const R = Math.max(6, UNITS[u.type].vision * 2) + CELL; // the high-ground and garrison range stays under twice the vision
    for (let y = Math.max(0, Math.floor((u.z - R) / CELL)); y <= Math.min(g.h - 1, Math.floor((u.z + R) / CELL)); y++)
      for (let x = Math.max(0, Math.floor((u.x - R) / CELL)); x <= Math.min(g.w - 1, Math.floor((u.x + R) / CELL)); x++)
        if (!vis[y * g.w + x] && fogSees(g, u, cellAt(g, y * g.w + x))) vis[y * g.w + x] = 1;
  }
  for (let c = 0; c < vis.length; c++) if (!vis[c] && reconOver(g, team, cellAt(g, c))) vis[c] = 1;
  for (const c of underSeen(g, team)) vis[c] = 1;
  return vis;
};
{
  const { updateVision, setCell, airborne } = massiveInternals, g = massiveFixture(), n = g.w * g.h;
  const teams = [...new Set(g.players.map(p => p.team))], ever = new Map(teams.map(t => [t, new Uint8Array(n)]));
  const flip = (str, into) => { sim.unpackRuns(str, (start, count) => { for (let c = start; c < start + count; c++) into[c] ^= 1; }); return into; };
  let clients = null;
  const pass = (label) => {
    g.tick += 4;
    updateVision(g);
    const masks = new Map();
    for (const team of teams) {
      const want = referenceFog(g, team), f = sim.teamFog(g, team);
      const extra = [], missing = [];
      for (let c = 0; c < n; c++) if (f.vis[c] !== want[c]) (f.vis[c] ? extra : missing).push(c);
      assert.equal(extra.length, 0, `${label}: team ${team}'s fog mask has no cell the team can't see (${extra.length} cells, first ${extra[0]})`);
      assert.equal(missing.length, 0, `${label}: team ${team}'s fog mask has every cell the team sees (${missing.length} cells missing, first ${missing[0]})`);
      assert.ok(underSeen(g, team).every(c => f.vis[c]), `${label}: every enemy ground unit team ${team} sees stands on clear ground`);
      const e = ever.get(team);
      for (let c = 0; c < n; c++) e[c] |= want[c];
      assert.deepEqual(f.explored, e, `${label}: team ${team} has explored every cell it has seen`);
      masks.set(team, f.vis.slice()); // teamFog reuses its buffers on later passes
    }
    if (!clients) {
      // match start: each player gets the whole mask and the explored cells
      clients = g.players.map((p, slot) => {
        const key = sim.fogFor(g, slot, true);
        assert.deepEqual(flip(key.e, new Uint8Array(n)), sim.teamFog(g, p.team).explored, `player ${slot}'s first fog carries the explored cells`);
        return flip(key.v, new Uint8Array(n));
      });
    } else g.players.forEach((p, slot) => { const delta = sim.fogFor(g, slot); if (delta !== undefined) flip(delta, clients[slot]); });
    g.players.forEach((p, slot) => {
      assert.deepEqual(clients[slot], masks.get(p.team), `${label}: player ${slot}'s client rebuilds its team's mask`);
      assert.equal(sim.fogFor(g, slot), undefined, `${label}: nothing more to send player ${slot} until the view changes`);
    });
    return masks;
  };
  const start = pass('start');
  assert.ok(teams.every(t => start.get(t).some(v => v) && start.get(t).some(v => !v)), 'every team sees part of the map');
  pass('standing'); pass('still standing'); // the second pass keeps the standing units' cells, the third reuses them
  const moved = new Set();
  for (const u of g.units.values()) {
    if (u.air) { u.air.state = ['base', 'out', 'station', 'home', 'rearm'][(u.id + 1) % 5]; continue; }
    if (u.id % 3 || UNITS[u.type].structure || UNITS[u.type].building) continue;
    u.x += 3; u.z -= 1; moved.add(u.id);
  }
  const after = pass('moved');
  assert.ok(teams.some(t => after.get(t).some((v, c) => v !== start.get(t)[c])), 'moving units changes the fog');
  pass('standing after the move');

  // one cell a single standing ground unit sees, well past 6 m and outside the recon corridor, and the cell halfway
  // along its sight line, away from the map edge and from every unit
  const team = 0, mask = sim.teamFog(g, team).vis, eyes = fogEyes(g, team), under = new Set(underSeen(g, team));
  const occupied = new Set([...g.units.values()].flatMap(t => t.cells ? [...t.cells] : [Math.floor(t.z / CELL) * g.w + Math.floor(t.x / CELL)]));
  const near = m => [-g.w - 1, -g.w, -g.w + 1, -1, 0, 1, g.w - 1, g.w, g.w + 1].map(k => m + k);
  let pick = null;
  for (let c = 0; c < n && !pick; c++) {
    const at = cellAt(g, c);
    if (!mask[c] || under.has(c) || reconOver(g, team, at)) continue;
    const by = eyes.filter(u => fogSees(g, u, at));
    if (by.length !== 1) continue;
    const u = by[0], d = Math.hypot(u.x - at.x, u.z - at.z);
    if (u.air || moved.has(u.id) || UNITS[u.type].building || d < 12 || massiveInternals.levelAt(g, u.x, u.z) > 2 || g.height[c] > 2) continue;
    const mx = (u.x + at.x) / 2, mz = (u.z + at.z) / 2, x = Math.floor(mx / CELL), y = Math.floor(mz / CELL), m = y * g.w + x;
    if (mx % CELL && mz % CELL && x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1 && g.chars[m] === '.' && near(m).every(k => !occupied.has(k))) pick = { c, m };
  }
  assert.ok(pick, 'the fixture has a cell only one standing unit sees');
  const { c, m } = pick, char = g.chars[m];
  setCell(g, m, 'H');
  assert.equal(pass('hedge').get(team)[c], 0, 'a new hedge hides the ground behind it from a unit that stood still');
  setCell(g, m, char);
  assert.equal(pass('hedge gone').get(team)[c], 1, 'the ground shows again once the hedge is gone');
  g.smokes.push({ ...cellAt(g, c), r: 1.5, t: 10 });
  assert.equal(pass('smoke').get(team)[c], 0, 'smoke over a cell hides it');
  g.smokes.length = 0;
  assert.equal(pass('smoke gone').get(team)[c], 1, 'the cell shows again once the smoke clears');
  const patch = near(m), levels = patch.map(k => g.height[k]);
  for (const k of patch) g.height[k] = CFG.maxLevel;
  g.terrainVersion++;
  assert.equal(pass('raised ground').get(team)[c], 0, 'raised ground in the way hides the cell');
  patch.forEach((k, i) => { g.height[k] = levels[i]; });
  g.terrainVersion++;
  assert.equal(pass('ground back').get(team)[c], 1, 'the cell shows again once the ground is back');
  // a shower shortens every unit's sight (updateVision's rule), and units that stood still through it follow
  const dry = sim.teamFog(g, team).vis.reduce((a, v) => a + v, 0);
  g.wx.rain = 1;
  const wet = pass('rain').get(team).reduce((a, v) => a + v, 0);
  assert.ok(wet < dry, `rain shrinks what the team sees (${dry} cells dry, ${wet} in rain)`);
  g.wx.rain = 0;
  assert.equal(pass('rain over').get(team).reduce((a, v) => a + v, 0), dry, 'the view comes back when the rain stops');
  // ground fog (the match weather) shortens sight the same way, buildings' own circles too
  g.weather = { now: 'fog', next: null, at: 0 };
  const foggy = pass('ground fog').get(team).reduce((a, v) => a + v, 0);
  assert.ok(foggy < dry, `ground fog shrinks what the team sees (${dry} cells clear, ${foggy} in fog)`);
  g.weather = { now: 'clear', next: null, at: 0 };
  assert.equal(pass('fog lifted').get(team).reduce((a, v) => a + v, 0), dry, 'the view comes back when the fog lifts');
  assert.ok(g.units.size === 300 && [...g.units.values()].some(u => u.air && airborne(u)), 'airborne planes took part');
}

// Reference before the cheap separation gates. Pair order and floating-point pushes are unchanged.
const referenceSeparation = `
  const list = [...g.units.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j], min = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
    if (a.garrison >= 0 || b.garrison >= 0 || a.air || b.air) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= min || d === 0) continue;
    const sa = UNITS[a.type].structure, sb = UNITS[b.type].structure;
    if (sa && sb) continue;
    const push = (min - d) / 2 * (sa || sb ? 1 : 0.5), px = dx / d * push, pz = dz / d * push;
    // a squad holding its cover is not pushed off it, and does not push back at a friend walking past
    const ha = !sa && shovedFromCover(g, a, a.x - px, a.z - pz), hb = !sb && shovedFromCover(g, b, b.x + px, b.z + pz);
    if (!sa && !ha && !(hb && a.path.length) && !(flagsAt(g, a.x - px, a.z - pz) & MOVE) && Math.abs(levelAt(g, a.x - px, a.z - pz) - levelAt(g, a.x, a.z)) <= 1) { a.x -= px; a.z -= pz; }
    if (!sb && !hb && !(ha && b.path.length) && !(flagsAt(g, b.x + px, b.z + pz) & MOVE) && Math.abs(levelAt(g, b.x + px, b.z + pz) - levelAt(g, b.x, b.z)) <= 1) { b.x += px; b.z += pz; }
  }
`;

// Twenty ticks of a seeded crowded army produce identical coordinates with the old separation loop.
{
  const source = readFileSync('shared/sim.js', 'utf8'), start = source.indexOf('  // soft separation;'), end = source.indexOf('  // grenades:', start);
  const old = await simCopy(source.slice(0, start) + referenceSeparation + source.slice(end));
  const g = massiveFixture(); g.players.forEach(p => { p.team = 0; }); g.mode.teams = 1;
  let seed = 123456;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const centers = [...g.units.values()].filter(u => UNITS[u.type].building).slice(0, 3);
  let i = 0;
  for (const u of g.units.values()) {
    u.cooldown = u.retarget = 1e9;
    if (UNITS[u.type].structure || u.garrison >= 0) continue;
    const at = centers[i++ % centers.length];
    Object.assign(u, { x: at.x + UNITS[at.type].radius + random() * 6, z: at.z + (random() - 0.5) * 12 });
  }
  const ground = [...g.units.values()].filter(u => !UNITS[u.type].structure && !u.air && u.garrison < 0);
  ground[1].x = ground[0].x; ground[1].z = ground[0].z; // the zero-distance rule still applies
  const expected = structuredClone(g), savedRandom = Math.random;
  try {
    for (let tick = 0; tick < 20; tick++) {
      seed = tick + 1; Math.random = random; step(g);
      seed = tick + 1; Math.random = random; old.step(expected);
      assert.deepEqual([...g.units.values()].map(u => [u.id, u.x, u.z]), [...expected.units.values()].map(u => [u.id, u.x, u.z]), `crowded positions exactly match after tick ${tick + 1}`);
    }
  } finally { Math.random = savedRandom; }
}

const referenceNearCover = (g, u) => {
  const solid = new Set(['B', '#', 'R', 'H', 'K']), x = Math.floor(u.x / CELL), y = Math.floor(u.z / CELL);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (solid.has(g.chars[(y + dy) * g.w + x + dx])) return true;
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if ('BK'.includes(g.chars[(y + dy) * g.w + x + dx] ?? ' ')) return true;
  return [...g.units.values()].some(v => v !== u && !v.air && !UNITS[v.type].infantry && massiveInternals.dist(u, v) < 3.5);
};

// Snapshot cover hints retain the old terrain, vehicle, structure and air exclusions.
{
  const g = massiveFixture();
  for (const u of g.units.values()) if (UNITS[u.type].infantry)
    assert.equal(massiveInternals.nearCover(g, u), referenceNearCover(g, u), `Massive cover hint matches for squad ${u.id}`);
  const flat = fresh(); flat.players[0].mp = 1000;
  const rifle = put(flat, 0, 'rifle', 10, 10), tank = put(flat, 0, 'tank', 30, 10), plane = put(flat, 0, 'fighter', 11, 10);
  for (const x of [30, 13.5, 13.499, 10]) {
    tank.x = x; tank.hp = 0; updateGrid(flat, tank); // the sim moves units through the grid (shared/grid.js)
    assert.equal(massiveInternals.nearCover(flat, rifle), referenceNearCover(flat, rifle), `cover hint preserves the radius and dead vehicle rule at ${x}`);
  }
  flat.units.delete(tank.id);
  assert.equal(massiveInternals.nearCover(flat, rifle), false, 'a nearby plane supplies no cover hint');
  for (const ch of ['B', '#', 'R', 'H', 'K']) {
    flat.chars[5 * flat.w + 6] = ch;
    assert.equal(massiveInternals.nearCover(flat, rifle), referenceNearCover(flat, rifle), `adjacent ${ch} preserves its cover hint`);
  }
}

// The cover preview (client/cover-preview.js) reads cover with the sim's own rules: what each cell gives, which house
// cells a squad can garrison, and directional cover from walls and vehicles toward a shooter.
{
  const preview = await import('./client/cover-preview.js');
  const real = await simCopy(readFileSync('shared/sim.js', 'utf8') + '\nexport { behindCover, entryCell };');
  const rows = [...empty];
  rows[3] = '...#....H....R......'; rows[5] = '....BBB...TTT..+....'; rows[6] = '....BBB.....Y...X...';
  rows[7] = '....BB....F=....##..'; rows[15] = '...O.....Q..........'; rows[9] = '..H.H....WWW........'; rows[12] = '.........#.#........';
  const g = fresh(rows); g.players[0].mp = 5000;
  g.chars[14 * 20 + 15] = 'K'; g.flags[14 * 20 + 15] = sim.TERRAIN.K; // a Classic building's footprint (never in map files)
  const at = (x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? '' : g.chars[y * g.w + x]);
  const tank = put(g, 0, 'tank', 25, 25), dead = put(g, 0, 'tank', 31, 11), plane = put(g, 0, 'fighter', 13, 29);
  dead.hp = 0;
  for (const u of [tank, dead, plane]) updateGrid(g, u);
  g.wrecks.push({ id: 99, type: 'tank', x: 21, z: 35 });
  const veh = [...g.units.values()].filter(v => !UNITS[v.type].air && !UNITS[v.type].infantry && v.hp > 0).flatMap(v => [v.x, v.z]).concat(g.wrecks.flatMap(v => [v.x, v.z]));
  // the ground's own cover, as coverMul sees a squad standing on the cell
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const ch = at(x, y), sq = { type: 'rifle', x: (x + 0.5) * CELL, z: (y + 0.5) * CELL }, kind = preview.cellCover(at, x, y);
    if (ch === 'B' || g.flags[y * g.w + x] & sim.MOVE) continue;
    const want = inTrench(g, sq) ? preview.HEAVY : sim.inCover(g, sq) ? preview.LIGHT : preview.OPEN;
    assert.equal(kind, want, `cover preview kind for ${ch} at ${x},${y}`);
  }
  assert.equal(preview.cellCover(at, 9, 9), preview.NONE, 'no marks on the river');
  // garrison: every house cell entryCell can hand out, and nothing else, is heavy cover
  const edges = new Set();
  for (let c; (c = real.entryCell(g, 5 * g.w + 4, { x: 0, z: 0 }, edges)) >= 0;) edges.add(c);
  for (let c = 0; c < g.chars.length; c++) if (g.chars[c] === 'B') {
    const x = c % g.w, y = Math.floor(c / g.w);
    assert.equal(preview.cellCover(at, x, y) === preview.HEAVY, edges.has(c), `house cell ${x},${y} garrison edge`);
    assert.equal(preview.cellCover(at, x, y, false), preview.NONE, 'squads that cannot garrison get no house marks');
  }
  assert.ok(edges.size >= 6 && edges.size < 11, `house edges found (${edges.size})`);
  // directional cover from each open cell toward shooters all round
  let covered = 0, checked = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (preview.cellCover(at, x, y) !== preview.OPEN) continue;
    const t = { x: (x + 0.5) * CELL, z: (y + 0.5) * CELL };
    for (let k = 0; k < 24; k++) {
      const from = { x: t.x + Math.cos(k * Math.PI / 12 + 0.05) * 20, z: t.z + Math.sin(k * Math.PI / 12 + 0.05) * 20 };
      const a = Math.atan2(from.z - t.z, from.x - t.x), ca = Math.cos(a), sa = Math.sin(a);
      const mine = preview.solidToward(at, t.x, t.z, ca, sa) || preview.vehicleToward(veh, veh.length / 2, t.x, t.z, ca, sa);
      assert.equal(mine, real.behindCover(g, t, from), `directional cover at ${x},${y} toward ${k * 15}°`);
      covered += mine; checked++;
    }
  }
  assert.ok(covered > 100 && covered < checked / 4, `directional cover is the exception, not the rule (${covered}/${checked})`);
  // cover fades with distance and damage: a hedge first met 2.9 m out covers while whole, not once nearly shot away
  const far = fresh(empty.map((r, y) => y === 10 ? r.slice(0, 12) + 'H' + r.slice(13) : r)), hedge = 10 * far.w + 12;
  const farAt = (x, y) => (x < 0 || y < 0 || x >= far.w || y >= far.h ? '' : far.chars[y * far.w + x]);
  const squad = { x: 21.5, z: 21 }, shooter = { x: 41, z: 21 };
  assert.ok(real.behindCover(far, squad, shooter) && preview.solidToward(farAt, squad.x, squad.z, 1, 0, () => 0), 'a whole hedge 2.9 m out covers');
  far.cellHp[hedge] = CFG.terrainHp.H * 0.2;
  assert.ok(!real.behindCover(far, squad, shooter) && !preview.solidToward(farAt, squad.x, squad.z, 1, 0, () => 2), 'a nearly gone one does not');
}

// The preview marks only ground this side has explored (the server's fog of war, client/fog.js). A new match brings a
// new fog, so the last match's ground (all of it once the fog lifted at the end) is not scouting; ground nobody has
// seen stays unmarked; and a rejoin, whose start message carries everything explored, has its marks back at once.
{
  const THREE = await import('three'), { createCoverPreview } = await import('./client/cover-preview.js');
  const noop = () => {}, handlers = {};
  const pen = new Proxy({}, { get: (_, k) => k === 'getImageData' ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : noop, set: () => true });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => pen }), getElementById: () => null };
  globalThis.addEventListener = noop;
  try {
    const W = 20, rows = Array.from({ length: W }, () => '.'.repeat(W).split('')), at = { x: 10, z: 10 }, mouse = { x: 1, y: 1, inside: true };
    let mesh = null, fog = { explored: new Uint8Array(W * W).fill(1), version: 7 }; // the last match, fog lifted
    const units = new Map([[1, { id: 1, type: 'rifle', owner: 0, x: 21, z: 21, hp: 100 }]]);
    const cp = createCoverPreview({ scene: { add: (m) => { mesh = m; } }, camera: new THREE.PerspectiveCamera(), units, selected: new Set([1]),
      canvas: { addEventListener: (type, fn) => { handlers[type] = fn; } }, hAt: () => 0, groundAt: () => ({ x: at.x * CELL + 1, z: at.z * CELL + 1 }),
      gfx: { low: false, onChange: noop }, foe: slot => slot !== 0, me: () => 0, mouse: () => mouse, targeting: () => null, grid: () => rows, state: () => null, fog: () => fog });
    const marks = () => { mouse.x++; cp.frame(0.016); return mesh.visible; }; // a moved mouse makes frame() look at the ground again
    fog = { explored: new Uint8Array(W * W), version: 8 }; // startGame makes the new match's fog before the preview starts
    cp.start();
    handlers.pointermove();
    assert.equal(marks(), false, 'the last match\'s ground does not count as scouted');
    for (let y = 8; y < 13; y++) for (let x = 8; x < 13; x++) fog.explored[y * W + x] = 1;
    fog.version = 9; // client/fog.js marks a change by its version
    assert.equal(marks(), true, 'scouted ground around the cursor is marked');
    const geo = mesh.geometry;
    assert.ok(geo.getAttribute('aEdge') && geo.getAttribute('aLine'), 'cover shields use the terrain overlay shader');
    for (const group of geo.groups) for (let i = group.start; i < group.start + group.count; i++) {
      const vi = geo.index.array[i];
      assert.ok(vi < geo.getAttribute('position').count, 'shield triangle stays inside the vertex buffer');
      assert.ok(Number.isFinite(geo.getAttribute('position').array[vi * 3]), 'shield vertex position is finite');
    }
    // A hull crosses the directional-cover threshold without leaving its 2 m terrain cell.
    units.set(2, { id: 2, type: 'tank', owner: 0, x: 24.45, z: 21, hp: 100 });
    units.set(3, { id: 3, type: 'rifle', owner: 1, x: 51, z: 21, hp: 100 });
    const centerColor = () => {
      const positions = mesh.geometry.getAttribute('position'), colors = mesh.geometry.getAttribute('color');
      for (const group of mesh.geometry.groups.slice(0, 2)) for (let i = group.start; i < group.start + group.count; i++) {
        const vi = mesh.geometry.index.array[i];
        if (Math.abs(positions.getX(vi) - 21) < 0.001 && Math.abs(positions.getZ(vi) - 21) < 0.001) return colors.getX(vi);
      }
      assert.fail('the cursor cell has a cover shield');
    };
    marks();
    assert.ok(Math.abs(centerColor() - new THREE.Color(0xe5483b).r) < 0.0001, 'a hull 3.45 m away leaves the center open');
    units.get(2).x = 24.35; cp.frame(0.016); // cursor, terrain and enemy stay still
    assert.ok(Math.abs(centerColor() - new THREE.Color(0xe2b850).r) < 0.0001, 'same-cell hull movement refreshes the protected center');
    units.get(3).z = 51.2; cp.frame(0.016);
    assert.ok(Math.abs(centerColor() - new THREE.Color(0xe2b850).r) < 0.0001, 'the hull covers just inside the allowed bearing');
    units.get(3).z = 51.8; cp.frame(0.016); // the enemy stays in the same cell but crosses the bearing limit
    assert.ok(Math.abs(centerColor() - new THREE.Color(0xe5483b).r) < 0.0001, 'same-cell enemy movement refreshes the exposed center');
    units.delete(2); units.delete(3); cp.frame(0.016);
    cp.flash(21, 21); cp.frame(0.2);
    assert.ok(geo.groups[2].count > 0 && mesh.material[2].visible, 'a move destination flashes the shield marks');
    cp.enabled = false; cp.frame(0.016);
    assert.equal(mesh.visible, false, 'turning off cover preview hides cursor and flash marks');
    cp.enabled = true; cp.frame(2); // let the earlier destination flash finish before checking a different spot
    at.x = at.z = 2;
    assert.equal(marks(), false, 'unscouted ground away from the scouted patch is not marked');
    fog = { explored: new Uint8Array(W * W), version: 10 };
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) fog.explored[y * W + x] = 1;
    cp.start();
    assert.equal(marks(), true, 'a rejoin keeps the ground explored before it');
  } finally { delete globalThis.document; delete globalThis.addEventListener; } // node has neither
}

// Unit row deltas: a fresh client gets every row, a row that stops changing is not resent, a unit that dies or goes
// under fog is named in gone, and a spectator joining the shared stream (full) gets every row again.
{
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['A', 'B'], false, [0, 1]), sent = new Map(), rows = () => snapshotFor(g, 0, []).units;
  const first = sim.unitDelta(sent, rows());
  assert.ok(first.units.length >= 2 && first.units.length === rows().length && !first.gone, 'a fresh join gets the full set');
  const quiet = sim.unitDelta(sent, rows());
  assert.deepEqual([quiet.units, quiet.gone, quiet.all], [[], undefined, undefined], 'unchanged units are not resent');
  const [moved, dead] = [...g.units.values()].filter(u => u.owner === 0);
  moved.x += 3; g.units.delete(dead.id);
  const next = sim.unitDelta(sent, rows());
  assert.deepEqual([next.units.map(r => r[0]), next.gone], [[moved.id], [dead.id]], 'only the changed row is sent, the removed unit is gone');
  // held fingerprints what the client should hold, so a drifted client can tell
  const xor = (ids) => ids.reduce((a, id) => a ^ id, 0), ids = rows().map(r => r[0]);
  assert.deepEqual(next.held, [ids.length, xor(ids)], 'held: the count and xor of the rows the client holds');
  const full = sim.unitDelta(sent, rows(), true);
  assert.ok(full.units.length === rows().length && full.all, 'full resends every row and tells the client to replace its own');
}

// Incremental terrain matches the prior ordered scan for each viewer's independent history.
{
  const g = massiveFixture(), memories = g.players.map(p => new Map(p.terrainMemory ?? []));
  const referenceTerrainFor = (slot, full = false) => {
    const p = g.players[slot], memory = memories[slot], changes = [], visible = new Map();
    for (const cell of g.cellLog) {
      const [c, ch, height] = cell, building = g.buildingCells?.get(c);
      if (building) {
        if (!visible.has(building)) visible.set(building, sim.allied(g, building.owner, slot)
          || (g.units.has(building.id) ? p.visible.has(building.id) : teamSees(g, p.team, building)));
        if (!visible.get(building)) continue;
      }
      const old = memory.get(c);
      if (old && old[1] === ch && old[2] === height) continue;
      const known = [...cell]; memory.set(c, known); changes.push(known);
    }
    return full ? [...memory.values()] : changes;
  };
  let comparison = 0;
  const check = (slot, full = false, snapshot = false) => {
    const expected = referenceTerrainFor(slot, full);
    g.visionTick = (g.visionTick ?? 0) + 1; // the hand edits to sight below stand in for a vision pass, which terrainFor waits on
    const actual = snapshot ? snapshotFor(g, slot, [], []).cells : sim.terrainFor(g, slot, full);
    assert.deepEqual(actual, expected, `incremental terrain comparison ${comparison++}: viewer ${slot}, full ${full}`);
    assert.deepEqual([...g.players[slot].terrainMemory], [...memories[slot]], 'incremental terrain preserves ordered remembered tuples');
    return actual;
  };
  for (let slot = 0; slot < g.players.length; slot++) check(slot, true);

  // Existing replay entries can change without extending the log. Writes can also return to the remembered value.
  const publicCells = g.cellLog.map(([c]) => c).filter(c => !g.buildingCells?.has(c));
  assert.ok(publicCells.length >= 3, 'terrain fixture contains public changed cells');
  const first = publicCells[0], last = publicCells.at(-1), remembered = g.players[0].terrainMemory.get(first);
  const logLength = g.cellLog.length, saved = check(0, true), savedBefore = structuredClone(saved);
  massiveInternals.setCell(g, last, g.chars[last] === '+' ? 'R' : '+');
  massiveInternals.setCell(g, first, remembered[1] === 'R' ? '+' : 'R');
  check(0, false, true);
  assert.equal(g.cellLog.length, logLength, 'updates to existing terrain do not grow the replay log');
  assert.deepEqual(saved, savedBefore, 'later changes do not mutate terrain tuples already returned for reconnect');
  const untouched = g.chars.findIndex((_, c) => !g.cellLogIndexes.has(c) && !g.buildingCells?.has(c));
  assert.ok(untouched >= 0, 'terrain fixture contains an unchanged public cell');
  massiveInternals.setCell(g, untouched, 'R');
  massiveInternals.setCell(g, first, g.chars[first] === '+' ? 'R' : '+');
  check(0);
  const beforeRevert = g.chars[first];
  massiveInternals.setCell(g, first, beforeRevert === '+' ? 'R' : '+');
  massiveInternals.setCell(g, first, beforeRevert);
  assert.equal(check(0).some(([c]) => c === first), false, 'same-cell writes that return to the remembered value emit no change');

  // An elevation change followed by a character-only write retains the latest elevation in the replay tuple.
  g.height ??= new Int8Array(g.w * g.h);
  g.height[first] = g.height[first] === -1 ? -2 : -1;
  massiveInternals.logCell(g, first, [first, g.chars[first], g.height[first]]);
  massiveInternals.setCell(g, first, g.chars[first] === '+' ? 'R' : '+');
  const crater = check(0).find(([c]) => c === first);
  assert.equal(crater[2], g.height[first], 'incremental terrain keeps elevation after a character-only transition');
  g.newCells = [];
  check(1, false, true);
  check(0, true);

  // Discover unchanged enemy footprints, retain their old terrain under fog, then revisit their rubble.
  const slot = 0, p = g.players[slot];
  const building = [...g.units.values()].find(u => u.cells && !sim.allied(g, u.owner, slot)
    && u.cells.every(c => g.buildingCells.get(c)?.id === u.id));
  assert.ok(building, 'terrain fixture contains an enemy building');
  p.visible.delete(building.id);
  for (const c of building.cells) massiveInternals.setCell(g, c, 'K');
  assert.equal(check(slot).some(([c]) => building.cells.includes(c)), false, 'hidden enemy footprint writes are withheld');
  p.visible.add(building.id);
  const visible = check(slot, false, true);
  assert.equal(visible.filter(([c, ch]) => building.cells.includes(c) && ch === 'K').length, building.cells.length,
    'visibility alone sends the complete unknown footprint');
  const oldTerrain = structuredClone(building.cells.map(c => p.terrainMemory.get(c)));
  p.visible.delete(building.id);
  const friendlyPositions = [...g.units.values()].filter(u => sim.allied(g, u.owner, slot)).map(u => [u, u.x, u.z]);
  for (const [u] of friendlyPositions) { u.x = -10000; u.z = -10000; }
  g.units.delete(building.id);
  massiveInternals.wreckBuilding(g, building);
  assert.equal(check(slot, false, true).some(([c]) => building.cells.includes(c)), false, 'unseen destruction remains withheld');
  const reconnect = check(slot, true);
  assert.deepEqual(building.cells.map(c => reconnect.find(([cell]) => cell === c)), oldTerrain, 'full reconnect keeps the last seen footprint under fog');
  const scout = friendlyPositions.find(([u]) => !u.air && !sim.UNITS[u.type].building)?.[0];
  assert.ok(scout, 'terrain fixture contains a ground scout');
  scout.x = building.x; scout.z = building.z;
  assert.equal(teamSees(g, p.team, g.buildingCells.get(building.cells[0])), true, 'the scout sees the destroyed building position');
  assert.equal(check(slot, false, true).filter(([c, ch]) => building.cells.includes(c) && ch === 'R').length, building.cells.length,
    'revisiting a destroyed building sends all rubble cells without new terrain writes');
  for (const [u, x, z] of friendlyPositions) { u.x = x; u.z = z; }

  // A replacement building gets a new footprint descriptor and must not reuse the old visibility decision.
  const replacementOwner = g.players.find(q => !sim.allied(g, q.slot, slot)).slot;
  const replacement = massiveInternals.placeBuilding(g, replacementOwner, building.type, building.cells[0], true);
  p.visible.delete(replacement.id);
  assert.equal(check(slot).some(([c]) => replacement.cells.includes(c)), false, 'hidden replacement footprint is withheld');
  p.visible.add(replacement.id);
  assert.equal(check(slot).filter(([c, ch]) => replacement.cells.includes(c) && ch === 'K').length, replacement.cells.length,
    'discovering a replacement catches up the complete current footprint');

  // Viewers consume at different rates; repeated writes and cleared transient batches must not lose changes.
  let state = 0x3c12;
  const pick = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  const chars = ['.', '+', 'R', 'T', 'W'];
  for (let i = 0; i < 96; i++) {
    const c = publicCells[pick(publicCells.length)];
    massiveInternals.setCell(g, c, chars[pick(chars.length)]);
    if (i % 5 === 0) {
      g.height[c] = -pick(3);
      massiveInternals.logCell(g, c, [c, g.chars[c], g.height[c]]);
    }
    if (i % 7 === 0) g.newCells = [];
    for (let viewer = 0; viewer < g.players.length; viewer++) if (i % (viewer + 1) === 0) check(viewer, false, i % 3 === 0);
    if (i % 13 === 0) check(pick(g.players.length), true);
  }
  for (let viewer = 0; viewer < g.players.length; viewer++) check(viewer, true);
}

// Every shipped map is valid, and every spawn can walk to every capture point and every other spawn (not across a naval map's sea).
for (const f of readdirSync('maps')) {
  const map = JSON.parse(readFileSync('maps/' + f, 'utf8'));
  assert.equal(validateMap(map), null, f);
  const g = createGame(map, ['a', 'b'], false), W = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
  // naval maps are islands: the sea is crossed by boat, so a spawn only has to reach a point on its own island
  if (map.naval) { for (const s of map.spawns) assert.ok(map.points.some(p => findPath(g, W(s), W(p)).length), `${f}: spawn ${s.x},${s.y} can reach a point`); continue; }
  for (const s of map.spawns) for (const p of [...map.points, ...map.spawns]) {
    if (p !== s) assert.ok(findPath(g, W(s), W(p)).length, `${f}: spawn ${s.x},${s.y} can reach ${p.x},${p.y}`);
  }
}

// Annihilation: everyone gets a fortified bunker; a side is out when its last bunker falls, no clock.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 1], [0, 1, 2, 0], { mode: 'annihilation' });
  const bunkers = [...g.units.values()].filter(u => u.type === 'bunker');
  assert.deepEqual(bunkers.map(b => b.owner).sort(), [0, 1, 2, 3], 'one bunker each');
  assert.ok(g.cellLog.filter(([, ch]) => ch === 'T').length >= 4 * 8, 'and trenches around every base');
  assert.ok(g.points.every(p => p.mp > 0), 'no VP-only points');
  assert.equal(g.players[0].mp, g.players[2].mp, 'both sides start equal');
  run(g, 20 * 60); // no clock: twenty quiet minutes later it's still on
  assert.equal(g.winner, null);
  bunkers.find(b => b.owner === 2).hp = 0; run(g, 0.1);
  assert.equal(g.winner, null, 'team 1 still has a bunker');
  bunkers.find(b => b.owner === 3).hp = 0; run(g, 0.1);
  assert.equal(g.winner, 0, 'last side with a bunker wins');
  const solo = createGame(map, ['a'], false, [0], [0], { mode: 'annihilation' });
  run(solo, 1); assert.equal(solo.winner, null, 'a solo test never ends by itself');
}

// A defeated Annihilation team cannot act while two other teams keep fighting.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 2], [0, 1, 2, 0], { mode: 'annihilation' });
  const bunker = slot => [...g.units.values()].find(u => u.owner === slot && u.type === 'bunker');
  const army = [...g.units.values()].filter(u => u.owner < 2 && !UNITS[u.type].structure);
  g.players[0].mp = 1000; g.players[1].mp = 1000;
  bunker(0).hp = 0; step(g);
  assert.deepEqual(g.players.map(p => !!p.out), [false, false, false, false], 'one remaining allied bunker keeps both players active');
  assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined, 'a surviving teammate allows recruitment');
  const point = g.points[0], squad = army[0];
  Object.assign(squad, { x: point.x, z: point.z, path: [] });
  Object.assign(point, { owner: -1, capper: 0, progress: 0.999 });
  bunker(1).hp = 0; step(g);
  assert.deepEqual(g.players.map(p => !!p.out), [true, true, false, false], 'the last bunker eliminates every member of that team');
  assert.equal(g.winner, null, 'two enemy teams are still fighting');
  assert.ok(![...g.units.values()].some(u => u.owner < 2), 'the defeated army is removed');
  assert.equal(point.owner, -1, 'defeated infantry cannot finish capturing on the defeat tick');
  const balances = g.players.slice(0, 2).map(p => p.mp), spent = g.story.slice(0, 2).map(s => s.mpSpent);
  for (const slot of [0, 1]) {
    for (const cmd of [
      { t: 'buy', unit: 'rifle' }, { t: 'support', kind: 'para', x: point.x, z: point.z },
      { t: 'move', orders: [[squad.id, point.x + 10, point.z]] }, { t: 'rally', x: point.x, z: point.z },
      { t: 'dig', ids: [squad.id], kind: 'trench', x: point.x, z: point.z },
      { t: 'orders', commands: [{ t: 'buy', unit: 'rifle' }] },
    ]) assert.equal(command(g, slot, cmd), 'blocked', `defeated player ${slot} cannot ${cmd.t}`);
    for (const level of AI_LEVEL_NAMES) {
      const submitted = [];
      think(g, slot, { level, submit: cmd => { submitted.push(cmd); } });
      assert.deepEqual(submitted, [], `${level} AI in defeated slot ${slot} submits no commands`);
    }
    assert.equal(snapshotFor(g, slot, []).out[slot], true, 'the client receives the defeat flag');
  }
  run(g, 10);
  assert.deepEqual(g.players.slice(0, 2).map(p => p.mp), balances, 'defeated players earn no manpower');
  assert.deepEqual(g.players.slice(0, 2).map(p => p.inc), [0, 0], 'the displayed income is zero');
  assert.deepEqual(g.story.slice(0, 2).map(s => s.mpSpent), spent, 'blocked commands spend no resources');
  assert.ok(![...g.units.values()].some(u => u.owner < 2), 'no defeated army is recreated');
  assert.equal(command(g, 2, { t: 'buy', unit: 'rifle' }), undefined, 'the surviving teams can still recruit');
}

// AI proofs compare equal human observations, including histories, while hidden state changes.
const aiRandom = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const aiDigest = g => createHash('sha256').update(JSON.stringify(g, (_key, value) => {
  if (value instanceof Map) return { map: [...value] };
  if (value instanceof Set) return { set: [...value] };
  if (ArrayBuffer.isView(value)) return { array: value.constructor.name, values: [...value] };
  if (value === undefined) return { undefined: true };
  if (typeof value === 'number' && !Number.isFinite(value)) return { number: String(value) };
  return value;
})).digest('hex');
const aiSnapshot = (g, slot) => snapshotFor({ ...g, skipFog: true, players: g.players.map(p => ({ ...p,
  terrainMemory: new Map(p.terrainMemory ?? []), terrainPending: new Set(p.terrainPending ?? g.cellLog.keys()),
})) }, slot, []);
const aiCommands = (g, slot, memory = {}, seed = 1, extra = {}) => {
  const random = Math.random, commands = [], before = aiDigest(g);
  let draws = 0;
  try {
    const seeded = aiRandom(seed); Math.random = () => { draws++; return seeded(); };
    think(g, slot, { ...extra, memory, submit: cmd => { commands.push(structuredClone(cmd)); } });
  } finally { Math.random = random; }
  assert.equal(aiDigest(g), before, 'dry-run AI leaves authoritative state unchanged');
  return { commands, draws };
};
const aiEquivalent = (a, b, slot = 0, memory = {}, seed = 1, message = 'hidden state does not affect AI commands', levels = AI_LEVEL_NAMES) => {
  assert.deepEqual(aiSnapshot(a, slot), aiSnapshot(b, slot), `${message}: human snapshots match`);
  let commands;
  for (const level of levels) {
    const left = aiCommands(a, slot, structuredClone(memory), seed, { level }), right = aiCommands(b, slot, structuredClone(memory), seed, { level });
    assert.deepEqual(right, left, `${message} (${level})`);
    if (level === 'normal') commands = left.commands;
  }
  return commands;
};
const aiMap = () => ({ w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)),
  spawns: [{ x: 2, y: 2 }, { x: 77, y: 77 }], points: [{ x: 40, y: 40 }] });

// Supply reconnection remains immediate at every level, including Easy's opening grace period.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]); g.units.clear(); g.players[0].mp = 0;
  const squad = [0, 1].map(() => massiveInternals.spawnUnit(g, 0, 'rifle'));
  squad.forEach((u, i) => Object.assign(u, { x: 50.5, z: 50.5 + i, cd: 999 }));
  const view = viewFor(g, 0, {}); Object.assign(view.points[0], { owner: 0, cut: true });
  for (const level of AI_LEVEL_NAMES) {
    const orders = aiCommands(g, 0, {}, 37, { view, level }).commands;
    assert.deepEqual(orders.find(c => c.t === 'amove')?.orders.map(o => o[0]), squad.map(u => u.id), `${level} reconnects an allied cut point without waiting for an enemy assault group`);
  }
}

// Hard keeps onward orders when switching focus targets and stops chasing a retreating squad.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]); g.units.clear(); g.players[0].mp = 0;
  const squad = [0, 1].map(i => massiveInternals.spawnUnit(g, 0, 'rifle'));
  const wounded = massiveInternals.spawnUnit(g, 1, 'rifle'), current = massiveInternals.spawnUnit(g, 1, 'rifle');
  Object.assign(wounded, { x: 56.5, z: 50.5, hp: 1 }); Object.assign(current, { x: 56.5, z: 51.5 });
  g.players[0].visible = new Set([wounded.id, current.id]);
  squad.forEach((u, i) => Object.assign(u, { x: 50.5, z: 50.5 + i * 0.5, cd: 999, targetId: current.id, attackId: current.id,
    orders: [{ t: 'amove', x: 81, z: 83 }], amove: null }));
  const memory = {};
  const firstLook = aiCommands(g, 0, memory, 431, { level: 'hard' }).commands;
  assert.ok(!firstLook.some(c => c.t === 'attack'), 'Hard watches a fight before it retargets');
  g.tick = 20;
  const focused = aiCommands(g, 0, memory, 431, { level: 'hard' }).commands;
  assert.ok(focused.some(c => c.t === 'attack' && c.target === wounded.id && c.ids.length === 2), 'once the wounded squad has been watched, Hard switches both shooters onto it');
  assert.deepEqual(focused.find(c => c.t === 'amove' && c.queue)?.orders, squad.map(u => [u.id, 81, 83]), 'a second focus order preserves the already queued onward destination');
  current.retreating = true; wounded.retreating = true;
  const stopped = aiCommands(g, 0, {}, 431, { level: 'hard' }).commands;
  assert.ok(!stopped.some(c => c.t === 'attack'), 'Hard does not issue a chase order against retreating enemies');
  assert.deepEqual(stopped.find(c => c.t === 'amove' && !c.queue)?.orders, squad.map(u => [u.id, 81, 83]), 'a retreating focus target releases the shooters to their onward orders');
}

// A newly spotted gun's private stationary timer cannot authorize an artillery call.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]), memory = {};
  const mg = massiveInternals.spawnUnit(g, 1, 'mg'); Object.assign(mg, { x: g.points[0].x, z: g.points[0].z, still: 0 });
  g.players[0].visible.add(mg.id); g.players[0].mp = 1000;
  const hiddenTimer = structuredClone(g); hiddenTimer.units.get(mg.id).still = 100;
  const first = aiEquivalent(g, hiddenTimer, 0, {}, 37, 'artillery uses observed stillness');
  assert.ok(!first.some(c => c.t === 'support' && c.kind === 'artillery'), 'first sight of one gun does not establish three seconds of stillness');
  aiCommands(g, 0, memory); g.tick = 80;
  assert.ok(aiCommands(g, 0, memory).commands.some(c => c.t === 'support' && c.kind === 'artillery'), 'four observed seconds qualify a stationary gun');
  mg.x += 1; g.tick = 100;
  assert.ok(!aiCommands(g, 0, memory).commands.some(c => c.t === 'support' && c.kind === 'artillery'), 'observed movement resets the timer');
  g.players[0].visible.delete(mg.id); g.tick = 120; aiCommands(g, 0, memory);
  g.players[0].visible.add(mg.id); mg.still = 100; g.tick = 200;
  assert.ok(!aiCommands(g, 0, memory).commands.some(c => c.t === 'support' && c.kind === 'artillery'), 'losing sight resets the timer before rediscovery');
}

// Landed planes disappear from the AI's current view on the same tick as human snapshots.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]), plane = massiveInternals.spawnUnit(g, 1, 'fighter');
  Object.assign(plane, { x: 8, z: 8 }); plane.air.state = 'rearm'; g.players[0].visible.add(plane.id); g.players[0].mp = 1000;
  const clean = structuredClone(g); clean.players[0].visible.delete(plane.id);
  aiEquivalent(clean, g, 0, {}, 98, 'a stale visible id for a landed plane is ignored');
  const memory = {}, view = viewFor(g, 0, memory);
  assert.ok(!view.units.has(plane.id) && !memory.seen.has(plane.id), 'landed enemy planes are absent from current units and new sightings');
  assert.equal(sim.seenBy(g, 0, plane.id), false, 'shared visibility predicate excludes landed planes');
}

// Positions, health, economy, cooldowns and strike phases use their public wire precision.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]), tank = massiveInternals.spawnUnit(g, 1, 'tank');
  Object.assign(tank, { x: 45.01, z: 5.01, hp: 299.1, supp: 0.1 }); g.players[0].visible.add(tank.id);
  g.players[0].mp = 1000.01; g.players[0].sup.recon = 1.01;
  g.strikes.push({ kind: 'strafe', owner: 1, x: 5.01, z: 5.01, dir: 0.01, t: 0.01, live: false, left: 1, next: 0 });
  const roundedTwin = structuredClone(g);
  Object.assign(roundedTwin.units.get(tank.id), { x: 45.04, z: 5.04, hp: 299.9, supp: 0.4 });
  roundedTwin.players[0].mp = 1000.99; roundedTwin.players[0].sup.recon = 1.99;
  Object.assign(roundedTwin.strikes[0], { x: 5.04, z: 5.04, dir: 0.04, t: -0.01, live: true });
  const commands = aiEquivalent(g, roundedTwin, 0, {}, 190, 'wire-equivalent precision changes do not affect decisions');
  assert.ok(!commands.some(c => c.t === 'support' && c.kind === 'dive'), 'a tank spotted on this look is not struck yet');
  assert.ok(!commands.some(c => c.t === 'support' && c.kind === 'cover'), 'a zero-countdown announcement is already active in the public view');
  const watched = {};
  aiCommands(g, 0, watched, 190);
  g.tick = 40;
  assert.ok(aiCommands(g, 0, watched, 190).commands.some(c => c.t === 'support' && c.kind === 'dive' && c.x === 45 && c.z === 5), 'once the tank has been watched, the dive aims at its rounded position');
  const control = structuredClone(g); control.players[0].visible.delete(tank.id);
  assert.notDeepEqual(aiCommands(control, 0, {}, 190).commands, commands, 'negative control: hiding a visible tank changes decisions');
}

// Unknown enemy depots do not claim resource nodes. A remembered depot stays claimed under fog.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic' });
  const node = g.nodes.at(-1), occupied = structuredClone(g);
  const depot = massiveInternals.placeBuilding(occupied, 1, 'depot', node.c, true); occupied.nodes.at(-1).depot = depot.id;
  assert.ok(!teamSees(occupied, 0, depot), 'enemy depot fixture is under fog');
  aiEquivalent(g, occupied, 0, {}, 43, 'an unseen depot does not change Engineer planning');
  // The strongest cases need an Engineer that walks to a node it cannot see: our depots already stand on the two nodes by the HQ.
  // An enemy then secretly takes the very node the Engineer would choose, and later every node outside the seat's vision.
  const staged = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic' });
  for (const n of staged.nodes.slice(0, 2)) n.depot = massiveInternals.placeBuilding(staged, 0, 'depot', n.c, true).id;
  massiveInternals.placeBuilding(staged, 0, 'barracks', 10 * staged.w + 2, true);
  massiveInternals.placeBuilding(staged, 0, 'motorpool', 10 * staged.w + 12, true);
  // A production building beside a node does not occupy it; only depots do.
  const beside = structuredClone(staged);
  let plant = null;
  for (let dy = -4; dy <= 4 && !plant; dy++) for (let dx = -4; dx <= 4 && !plant; dx++) {
    const trial = structuredClone(beside);
    try {
      const at = massiveInternals.placeBuilding(trial, 0, 'barracks', trial.nodes[2].c + dy * trial.w + dx, true);
      if (Math.hypot(at.x - trial.nodes[2].x, at.z - trial.nodes[2].z) < 8) { plant = at; Object.assign(beside, trial); }
    } catch { /* this spot does not fit on the map */ }
  }
  assert.ok(plant, 'a Barracks fits within 8 m of a free node');
  assert.deepEqual([...viewFor(beside, 0, {}).claimedNodes].sort(), [0, 1], 'only the two depots claim nodes');
  const engineers = new Set([...staged.units.values()].filter(u => u.owner === 0 && u.type === 'engineer').map(u => u.id));
  const heading = aiCommands(staged, 0, {}, 43).commands.flatMap(c => c.t === 'move' ? c.orders.filter(([id]) => engineers.has(id)) : []);
  assert.ok(heading.length, 'the Engineer fixture walks toward a resource node');
  const chosen = staged.nodes.findIndex(n => Math.hypot(n.x - heading[0][1], n.z - heading[0][2]) < 1);
  assert.ok(chosen >= 2 && !teamSees(staged, 0, staged.nodes[chosen]), 'the chosen node is a resource node under fog');
  const redirected = structuredClone(staged), chosenDepot = massiveInternals.placeBuilding(redirected, 1, 'depot', redirected.nodes[chosen].c, true);
  redirected.nodes[chosen].depot = chosenDepot.id;
  aiEquivalent(staged, redirected, 0, {}, 43, 'a secretly taken node does not redirect the Engineer');
  const crowded = structuredClone(staged);
  for (const n of crowded.nodes) if (!n.depot && !teamSees(staged, 0, n)) n.depot = massiveInternals.placeBuilding(crowded, 1, 'depot', n.c, true).id;
  assert.ok(crowded.nodes.every(n => n.depot), 'every node is occupied, the unseen ones secretly');
  aiEquivalent(staged, crowded, 0, {}, 43, 'secretly taken nodes do not change how many Engineers the AI buys');
  const memory = {}, known = structuredClone(occupied);
  known.players[0].visible.add(depot.id); known.ghosts ??= new Map();
  known.ghosts.set(0, new Map([[depot.id, { id: depot.id, type: 'depot', owner: 1, x: depot.x, z: depot.z, built: 1 }]]));
  snapshotFor(known, 0, []);
  assert.ok(viewFor(known, 0, memory).claimedNodes.has(known.nodes.length - 1), 'visible enemy depots claim their observed node');
  known.players[0].visible.delete(depot.id); massiveInternals.wreckBuilding(known, known.units.get(depot.id)); known.units.delete(depot.id);
  assert.ok(viewFor(known, 0, memory).claimedNodes.has(known.nodes.length - 1), 'unseen destruction retains the Ghost occupancy belief');
  assert.equal(viewFor(known, 0, {}).chars[depot.cells[0]], 'K', 'human handover seeds the AI with the seat\'s remembered footprint');
  known.ghosts.get(0).delete(depot.id);
  assert.ok(!viewFor(known, 0, memory).claimedNodes.has(known.nodes.length - 1), 'revisiting the empty node clears the Ghost occupancy belief');
}

// Cover choices and site searches use remembered terrain through hidden placement and removal.
{
  const map = aiMap(); map.rows[39] = '.'.repeat(39) + 'TTT' + '.'.repeat(38);
  map.rows[40] = map.rows[39]; map.rows[41] = map.rows[39];
  const g = createGame(map, ['AI', 'enemy'], false, [0, 1]); g.players[0].mp = 0;
  const footprint = structuredClone(g), barracks = massiveInternals.placeBuilding(footprint, 1, 'barracks', 39 * g.w + 39, true);
  aiEquivalent(g, footprint, 0, {}, 15, 'unseen footprints do not erase remembered capture-point cover');
  const projected = viewFor(footprint, 0, {});
  assert.equal(projected.chars[barracks.cells[0]], 'T', 'AI terrain retains the public map beneath an unseen building');
  massiveInternals.wreckBuilding(footprint, barracks); footprint.units.delete(barracks.id);
  aiEquivalent(g, footprint, 0, {}, 15, 'unseen rubble does not erase remembered capture-point cover');

  const classic = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], [0, 1], { mode: 'classic' });
  const hq = [...classic.units.values()].find(u => u.owner === 0 && u.type === 'hq'); classic.units.delete(hq.id);
  for (const u of classic.units.values()) if (u.owner === 0) Object.assign(u, { x: 130, z: 130 });
  for (let i = 0; i < 2; i++) {
    const id = classic.nextId++; classic.units.set(id, { ...structuredClone(hq), id, type: 'depot', x: 130 + i * 8, z: 130, hp: UNITS.depot.hpPer, queue: [] });
  }
  classic.players[0].mp = 1000;
  const build = aiCommands(classic, 0, {}, 72, { adaptive: false }).commands.find(c => c.t === 'build' && c.kind === 'barracks');
  assert.ok(build, 'lost-HQ fixture searches for a Barracks site');
  assert.ok(!teamSees(classic, 0, build), 'fallback site is outside current team vision');
  const blocked = structuredClone(classic), c = Math.floor((build.z - 3) / CELL) * classic.w + Math.floor((build.x - 3) / CELL);
  const enemy = massiveInternals.placeBuilding(blocked, 1, 'barracks', c, true);
  aiEquivalent(classic, blocked, 0, {}, 72, 'unseen footprints do not shift a fallback building site');
  massiveInternals.wreckBuilding(blocked, enemy); blocked.units.delete(enemy.id);
  aiEquivalent(classic, blocked, 0, {}, 72, 'unseen destruction does not shift a fallback building site');
  for (const cell of enemy.cells) massiveInternals.setCell(blocked, cell, '.');
  aiEquivalent(classic, blocked, 0, {}, 72, 'unseen cancellation does not shift a fallback building site');
  const engineer = [...classic.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  assert.equal(command(blocked, 0, { ...build, ids: [engineer.id] }), 'notVisible', 'authoritative command still rejects the blind proposed site');
}

// Entrenching and taking cover plan on remembered terrain; auto-retreat is set from the seat's own units.
{
  const field = (trench, mp = 95) => { // 95 MP is enough to dig (digCost + 60 kept back) but not to lay mines first (mines.cost + 60)
    const map = aiMap();
    if (trench) for (const r of [39, 40, 41]) map.rows[r] = '.'.repeat(39) + 'TTT' + '.'.repeat(38);
    const g = createGame(map, ['AI', 'enemy'], false, [0, 1]);
    const squad = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
    Object.assign(squad, { x: g.points[0].x, z: g.points[0].z }); g.points[0].owner = 0; g.players[0].mp = mp;
    return { g, squad };
  };
  // Positive control: on open ground the squad holding a point entrenches, and every squad is put on auto-retreat.
  const open = field(false), plain = aiCommands(open.g, 0, {}, 5).commands;
  const dug = plain.find(c => c.t === 'entrench');
  assert.ok(dug && dug.ids.includes(open.squad.id) && dug.pattern === 'arc', 'a squad holding open ground entrenches');
  assert.ok(!plain.some(c => c.t === 'stance'), 'a squad holding a quiet point is not armed to retreat before any fight');
  // Trench already stands around the point (public map): no new entrenchment, the squad takes cover in it instead.
  const dugIn = field(true); dugIn.squad.x += 6; // beside the trench, still on the point
  const known = aiCommands(dugIn.g, 0, {}, 5).commands;
  assert.ok(!known.some(c => c.t === 'entrench'), 'a point with trench around it is not entrenched again');
  assert.ok(known.some(c => c.t === 'cover' && c.ids.includes(dugIn.squad.id)), 'the squad takes cover in the existing trench');
  // An unseen enemy building covers that trench. The seat's remembered map still shows it, so nothing changes.
  const hidden = structuredClone(dugIn.g), post = massiveInternals.placeBuilding(hidden, 1, 'barracks', 39 * hidden.w + 39, true);
  assert.ok(!teamSees(hidden, 0, post), 'the enemy building is under fog');
  aiEquivalent(dugIn.g, hidden, 0, {}, 5, 'an unseen building over trench cells does not trigger an entrenchment');
  // With manpower to spare the holding squad lays mines first. It counts the minefields its own side laid and no others:
  // enemy mines are never reported to the seat, so they cannot make it skip laying its own.
  const rich = field(false, 1000), laid = aiCommands(rich.g, 0, {}, 5).commands.find(c => c.t === 'dig' && c.kind === 'mines');
  assert.ok(laid && laid.ids.includes(rich.squad.id), 'a squad with manpower to spare lays mines at the point it holds');
  const mineCells = [0, 1].map(i => Math.floor(rich.g.points[0].z / CELL) * rich.g.w + Math.floor(rich.g.points[0].x / CELL) + 5 + i);
  const own = structuredClone(rich.g), foe = structuredClone(rich.g);
  for (const c of mineCells) { massiveInternals.setCell(own, c, 'N'); own.mines.set(c, 0); massiveInternals.setCell(foe, c, 'N'); foe.mines.set(c, 1); }
  assert.equal(viewFor(own, 0, {}).mines.length, 2, 'the seat knows the mines its own side laid');
  assert.equal(viewFor(foe, 0, {}).mines.length, 0, 'the seat is not told about enemy mines');
  aiEquivalent(rich.g, foe, 0, {}, 5, 'enemy mines do not change where the AI lays its own');
  assert.ok(!aiCommands(own, 0, {}, 5).commands.some(c => c.t === 'dig' && c.kind === 'mines'), 'two minefields of its own are enough');
  // Mined and dug in, a squad with manpower to spare strings wire across the approach, then tank traps once the
  // enemy has shown armor.
  const fortified = field(true, 1000);
  for (const c of mineCells) { massiveInternals.setCell(fortified.g, c, 'N'); fortified.g.mines.set(c, 0); }
  const next = (memory) => aiCommands(fortified.g, 0, memory, 5).commands.find(c => c.t === 'entrench' && c.ids.includes(fortified.squad.id));
  assert.equal(next({})?.fort, 'wire', 'a dug-in point gets barbed wire next');
  const ahead = next({}), wireAt = Math.floor((ahead.z + ahead.z2) / 2 / CELL) * fortified.g.w + Math.floor((ahead.x + ahead.x2) / 2 / CELL);
  for (const c of [wireAt - 2, wireAt - 1, wireAt, wireAt + 1, wireAt + 2]) massiveInternals.setCell(fortified.g, c, 'X');
  assert.equal(next({}), undefined, 'with wire up and no enemy armor seen, nothing more is built');
  assert.equal(next({ armor: true })?.fort, 'traps', 'once enemy armor has been seen, tank traps go in');
  // Stances come from the seat's own rows: once a squad reports auto-retreat the AI stops ordering it.
  open.squad.autoRetreat = true;
  assert.ok(!aiCommands(open.g, 0, {}, 5).commands.some(c => c.t === 'stance' && c.ids.includes(open.squad.id)), 'a squad already on auto-retreat is left alone');
  // A squad already on a mass entrenchment is not given another one.
  open.squad.entrench = { jobs: [{ x: 1, z: 1 }], active: 0, crew: 1 };
  assert.ok(!aiCommands(open.g, 0, {}, 5).commands.some(c => c.t === 'entrench'), 'a squad on a mass entrenchment is not ordered to entrench again');
}

// A fight is watched before squads are told to fall back. The order is a decision, not a switch flipped at match start.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]); g.units.clear(); g.players[0].mp = 0;
  const squad = massiveInternals.spawnUnit(g, 0, 'rifle'), foe = massiveInternals.spawnUnit(g, 1, 'rifle');
  Object.assign(squad, { x: 80, z: 80, autoRetreat: false }); Object.assign(foe, { x: 88, z: 80 }); // switched off, as a player can
  g.players[0].visible.add(foe.id);
  const memory = {};
  assert.ok(!aiCommands(g, 0, memory, 5).commands.some(c => c.t === 'stance'), 'the first look at an enemy does not arm auto-retreat');
  g.tick = 40;
  const armed = aiCommands(g, 0, memory, 5).commands.find(c => c.t === 'stance' && c.key === 'autoRetreat' && c.on === true);
  assert.ok(armed && armed.ids.includes(squad.id), 'after the contact has been watched, the squad in that fight is told to fall back if it breaks');
}

// Losses stay in the commander's head after the killer leaves sight, and a point that ate squads is avoided.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]); g.units.clear(); g.players[0].mp = 0;
  const rifle = massiveInternals.spawnUnit(g, 0, 'rifle'), tank = massiveInternals.spawnUnit(g, 1, 'tank');
  Object.assign(rifle, { x: 40, z: 40 }); Object.assign(tank, { x: 48, z: 40 });
  g.players[0].visible.add(tank.id);
  const memory = {};
  aiCommands(g, 0, memory, 11);
  g.units.delete(rifle.id); g.players[0].visible.delete(tank.id); g.players[0].mp = 1000;
  const learned = aiCommands(g, 0, memory, 11).commands.filter(c => c.t === 'buy').map(c => c.unit);
  assert.ok(memory.mind.respect.tank >= 1, 'a squad lost beside a tank is remembered as a tank');
  assert.ok(learned.includes('at') && !learned.includes('rifle'), 'the next buy is an AT gun even though the tank is no longer in sight');

  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 4, y: 40 }, { x: 75, y: 40 }], points: [{ x: 20, y: 40 }, { x: 55, y: 40 }] };
  const field = createGame(map, ['AI', 'enemy'], false, [0, 1]); field.units.clear(); field.players[0].mp = 0;
  const held = field.points[0];
  const lost = [0, 1, 2].map(() => massiveInternals.spawnUnit(field, 0, 'rifle'));
  lost.forEach(u => Object.assign(u, { x: held.x, z: held.z }));
  const mind = {};
  aiCommands(field, 0, mind, 3);
  lost.forEach(u => field.units.delete(u.id));
  aiCommands(field, 0, mind, 3);
  assert.equal(mind.mind.points[0].failed, 3, 'three squads lost on a point are three failures');
  const fresh = massiveInternals.spawnUnit(field, 0, 'rifle');
  Object.assign(fresh, field.players[0].spawn);
  const march = aiCommands(field, 0, mind, 3);
  assert.equal(mind.mind.decision.aim, 1, 'the next decision picks the other point');
  const step = march.commands.find(c => c.t === 'move' || c.t === 'amove');
  assert.ok(step && step.orders.some(([, x]) => x > 70), 'the squad is sent toward the point that has not killed anyone');
}

// A remembered tank is a threat the rifles do not walk into. The plan holds, then it can change.
{
  const onto = (commands, ids, at, r = 28) => commands.some(c => (c.t === 'amove' || c.t === 'move') && c.orders?.some(([id, x, z]) => ids.includes(id) && Math.hypot(x - at.x, z - at.z) <= r));
  const field = () => {
    const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]);
    g.units.clear(); g.players[0].mp = 1000;
    const rifles = [0, 1].map(i => { const u = massiveInternals.spawnUnit(g, 0, 'rifle'); Object.assign(u, { x: 8 + i * 2, z: 8, cd: 999 }); return u; });
    const tank = massiveInternals.spawnUnit(g, 1, 'tank');
    Object.assign(tank, { x: g.points[0].x, z: g.points[0].z });
    g.points[0].owner = 1;
    g.players[0].visible.add(tank.id);
    return { g, rifles, tank, at: { x: g.points[0].x, z: g.points[0].z } };
  };
  const seen = field(), memory = {};
  aiCommands(seen.g, 0, memory, 7, { level: 'normal' });
  seen.g.players[0].visible.delete(seen.tank.id); seen.g.units.delete(seen.tank.id);
  const waiting = aiCommands(seen.g, 0, memory, 7, { level: 'normal' });
  assert.equal(memory.mind.decision.situation, 'wait', 'a tank that left sight, and is still stronger than the rifles, is a wait');
  assert.ok(!onto(waiting.commands, seen.rifles.map(u => u.id), seen.at), 'rifles are not attack-moved onto a tank the seat still remembers');
  const bought = waiting.commands.filter(c => c.t === 'buy').map(c => c.unit);
  assert.ok(bought.includes('at') && !bought.includes('rifle') && !bought.includes('mg'), 'with no anti-tank gun fielded, the next rifle or machine-gun buy is anti-tank');
  seen.g.tick = 20 * 61;
  const expired = aiCommands(seen.g, 0, memory, 7, { level: 'normal' });
  assert.notEqual(memory.mind.decision.situation, 'wait', 'once the sighting is older than a minute the wait is over');
  assert.ok(onto(expired.commands, seen.rifles.map(u => u.id), seen.at), 'after the sighting expires the rifles may attack that ground');

  const looked = field(), lookedAt = {};
  aiCommands(looked.g, 0, lookedAt, 7, { level: 'normal' });
  looked.g.players[0].visible.delete(looked.tank.id); looked.g.units.delete(looked.tank.id);
  aiCommands(looked.g, 0, lookedAt, 7, { level: 'normal' });
  Object.assign(looked.rifles[0], { x: looked.at.x, z: looked.at.z + 30 });
  const empty = aiCommands(looked.g, 0, lookedAt, 7, { level: 'normal' });
  assert.notEqual(lookedAt.mind.decision.situation, 'wait', 'looking at the empty ground retires the remembered tank');
  assert.ok(onto(empty.commands, [looked.rifles[0].id], looked.at) || onto(empty.commands, looked.rifles.map(u => u.id), looked.at), 'once the ground has been seen empty a later decision may attack');

  const escorted = field();
  const gun = massiveInternals.spawnUnit(escorted.g, 0, 'at');
  Object.assign(gun, { x: 10, z: 10, cd: 999 });
  const gunMemory = {};
  aiCommands(escorted.g, 0, gunMemory, 7, { level: 'normal' });
  escorted.g.players[0].visible.delete(escorted.tank.id); escorted.g.units.delete(escorted.tank.id);
  const withGun = aiCommands(escorted.g, 0, gunMemory, 7, { level: 'normal' });
  assert.ok(onto(withGun.commands, [gun.id], escorted.at), 'the anti-tank gun is ordered toward the remembered armor');
  assert.ok(!onto(withGun.commands, escorted.rifles.map(u => u.id), escorted.at), 'the rifles are not sent onto that armor alone');

  const same = field(), base = {};
  aiCommands(same.g, 0, base, 7, { level: 'normal' });
  same.g.players[0].visible.delete(same.tank.id); same.g.units.delete(same.tank.id);
  aiCommands(same.g, 0, base, 7, { level: 'normal' });
  const leftMem = structuredClone(base), rightMem = structuredClone(base);
  const left = aiCommands(same.g, 0, leftMem, 7, { level: 'normal' });
  const right = aiCommands(same.g, 0, rightMem, 7, { level: 'normal' });
  assert.deepEqual(left.commands, right.commands, 'the same view, memory, level, and tick produce the same orders');
  assert.equal(leftMem.mind.decision.situation, rightMem.mind.decision.situation, 'both looks name the same situation');
  assert.equal(leftMem.mind.decision.situation, 'wait');

  const pace = field();
  const easy = {}, hard = {};
  aiCommands(pace.g, 0, easy, 7, { level: 'easy' });
  aiCommands(pace.g, 0, hard, 7, { level: 'hard' });
  assert.ok(easy.mind.operation.until > hard.mind.operation.until, 'Easy keeps an operation longer than Hard');
  assert.equal(easy.mind.decision.situation, hard.mind.decision.situation);

  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 4, y: 40 }, { x: 75, y: 40 }], points: [{ x: 20, y: 40 }, { x: 60, y: 40 }] };
  const hold = createGame(map, ['AI', 'enemy'], false, [0, 1]);
  hold.units.clear(); hold.players[0].mp = 0;
  const squads = [0, 1].map(i => { const u = massiveInternals.spawnUnit(hold, 0, 'rifle'); Object.assign(u, { x: 12 + i, z: 81, cd: 999 }); return u; });
  hold.points[0].owner = 0; hold.points[1].owner = 1;
  const plan = {};
  aiCommands(hold, 0, plan, 4, { level: 'normal' });
  assert.equal(plan.mind.decision.situation, 'push');
  assert.equal(plan.mind.operation.point, 1);
  const foe = massiveInternals.spawnUnit(hold, 1, 'rifle');
  Object.assign(foe, { x: hold.points[0].x, z: hold.points[0].z, cd: 999 });
  hold.players[0].visible.add(foe.id);
  const young = aiCommands(hold, 0, plan, 4, { level: 'normal' });
  assert.equal(plan.mind.decision.situation, 'push', 'a contact younger than the notice delay does not cancel the attack');
  assert.equal(plan.mind.operation.point, 1);
  assert.ok(!young.commands.some(c => c.t === 'attack' || c.t === 'support' || (c.t === 'ability' && c.ids)), 'a contact younger than the notice delay is not struck yet');
  hold.tick = 40;
  const defending = aiCommands(hold, 0, plan, 4, { level: 'normal' });
  assert.equal(plan.mind.decision.situation, 'defense', 'a watched enemy on a held point becomes a defense');
  assert.ok(onto(defending.commands, squads.map(u => u.id), foe, 20), 'idle squads are ordered toward the threat on the held point');
  assert.ok(!defending.commands.some(c => (c.t === 'amove' || c.t === 'move') && c.orders?.some(([, x]) => x > 100)), 'that look does not open the other enemy point');

  const siren = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]);
  siren.units.clear(); siren.players[0].mp = 1000;
  const watcher = massiveInternals.spawnUnit(siren, 0, 'rifle');
  Object.assign(watcher, { x: 40, z: 40, cd: 999 });
  const freshTank = massiveInternals.spawnUnit(siren, 1, 'tank');
  Object.assign(freshTank, { x: 140, z: 140 });
  siren.players[0].visible.add(freshTank.id);
  siren.strikes.push({ kind: 'bombing', owner: 1, x: 42, z: 40, dir: 0, t: 4, live: false, left: 1, next: 0 });
  const cover = aiCommands(siren, 0, {}, 7, { level: 'normal' });
  assert.ok(cover.commands.some(c => c.t === 'support' && c.kind === 'cover'), 'an announced enemy air strike is answered at once with fighter cover');
  assert.ok(!cover.commands.some(c => c.t === 'support' && c.kind !== 'cover'), 'the fresh tank is not struck on the look it appears');

  // A player who will not walk rifles into a tank still takes the other point.
  const split = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 4, y: 40 }, { x: 75, y: 40 }], points: [{ x: 20, y: 40 }, { x: 60, y: 40 }] };
  const board = createGame(split, ['AI', 'enemy'], false, [0, 1]);
  board.units.clear(); board.players[0].mp = 1000;
  // Far enough that losing the tank does not count as seeing that ground empty (rifle vision is 36 m).
  const foot = [0, 1].map(i => { const u = massiveInternals.spawnUnit(board, 0, 'rifle'); Object.assign(u, { x: 12 + i, z: 20, cd: 999 }); return u; });
  const armor = massiveInternals.spawnUnit(board, 1, 'tank');
  Object.assign(armor, { x: board.points[0].x, z: board.points[0].z });
  board.points[0].owner = 1; board.points[1].owner = 1;
  board.players[0].visible.add(armor.id);
  const acted = {};
  aiCommands(board, 0, acted, 7, { level: 'normal' });
  board.players[0].visible.delete(armor.id); board.units.delete(armor.id);
  const other = aiCommands(board, 0, acted, 7, { level: 'normal' });
  assert.equal(acted.mind.decision.situation, 'wait', 'the tank is still a wait');
  assert.equal(acted.mind.decision.action, 'take-other', 'the action is the clear point, not a freeze');
  assert.ok(!onto(other.commands, foot.map(u => u.id), board.points[0]), 'rifles are not sent onto the tank point');
  assert.ok(onto(other.commands, foot.map(u => u.id), board.points[1]), 'the squads take the other point');
  const otherBuy = other.commands.filter(c => c.t === 'buy').map(c => c.unit);
  assert.ok(otherBuy.includes('at') && !otherBuy.includes('rifle') && !otherBuy.includes('mg'), 'the purchase is still the missing anti-tank gun');
  console.log('AI situation: wait, empty ground, expired sighting, escorted gun, lasting attack, defense, young contact, fighter cover, and repeated looks checked');
  console.log('AI action: a remembered tank keeps rifles off that point while the squads take a different one');
}

// A blown bridge is put back using the public map and the seat's remembered terrain; one still standing is left alone.
{
  const map = aiMap();
  for (let r = 0; r < 80; r++) map.rows[r] = '.'.repeat(30) + ([39, 40, 41].includes(r) ? '====' : 'WWWW') + '.'.repeat(46);
  const span = [39, 40, 41].flatMap(r => [30, 31, 32, 33].map(c => r * 80 + c));
  const standing = createGame(map, ['AI', 'enemy'], false, [0, 1]); standing.players[0].mp = 1000;
  // The AI first looks at the intact map, then the bridge is blown.
  const lookedAt = {}, intact = aiCommands(standing, 0, lookedAt, 9).commands;
  assert.ok(!intact.some(c => c.t === 'dig' && c.kind === 'bridge'), 'an intact bridge is not rebuilt');
  const blown = structuredClone(standing);
  for (const c of span) massiveInternals.setCell(blown, c, 'W');
  const rebuild = (g, seed = 9) => aiCommands(g, 0, structuredClone(lookedAt), seed).commands.find(c => c.t === 'dig' && c.kind === 'bridge');
  const order = rebuild(blown);
  assert.ok(order && order.x >= 60 && order.x <= 68 && order.z >= 76 && order.z <= 86 && order.dir === 0, 'a blown bridge gets a builder squad, laid along the shorter stretch of water');
  // The squad it sent is remembered: while it digs, no second bridge squad is sent, and once it is done the memory clears.
  const memory = structuredClone(lookedAt), first = aiCommands(blown, 0, memory, 9);
  assert.ok(first.commands.some(c => c.t === 'dig' && c.kind === 'bridge'), 'the first look orders the bridge');
  const sent = first.commands.find(c => c.t === 'dig' && c.kind === 'bridge').ids[0];
  blown.units.get(sent).dig = { x: order.x, z: order.z, cells: span.map(c => [c, '=']), t: 0 };
  assert.ok(!aiCommands(blown, 0, memory, 9).commands.some(c => c.t === 'dig' && c.kind === 'bridge'), 'a squad already digging the bridge is not given company');
  blown.units.get(sent).dig = null; blown.tick += 20;
  assert.ok(aiCommands(blown, 0, memory, 9).commands.some(c => c.t === 'dig' && c.kind === 'bridge'), 'once that squad stops, the still-missing bridge is ordered again');
  // Hidden enemy state changes nothing about it.
  const hidden = structuredClone(blown); massiveInternals.placeBuilding(hidden, 1, 'barracks', 60 * hidden.w + 60, true);
  aiEquivalent(blown, hidden, 0, lookedAt, 9, 'an unseen enemy building does not change the bridge job');
}

// The AI is told the weather every player is told, and its sight and caution match the game's under every weather.
{
  const { WEATHER_KINDS, aiCaution } = await import('./shared/weather.js');
  for (const kind of WEATHER_KINDS) {
    const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], undefined, { weather: kind }), view = viewFor(g, 0, {});
    assert.equal(view.weather.now, kind, `${kind}: the view carries the match weather`);
    assert.equal(aiCaution(view), aiCaution(g), `${kind}: the AI's caution is the game's`);
    for (let x = 4; x < 160; x += 12) for (let z = 4; z < 160; z += 12) assert.equal(view.sees({ x, z }), teamSees(g, 0, { x, z }), `${kind}: the view sees what the team sees at (${x}, ${z})`);
  }
  // Weather that is planned but not yet announced is hidden: only the ten second warning reveals what comes next.
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], undefined, { weather: 'clear' });
  Object.assign(g.weather, { next: 'fog', at: g.tick + 20 * 600 });
  assert.equal(viewFor(g, 0, {}).weather.next, undefined, 'a weather change more than ten seconds away is not in the view');
  g.weather.at = g.tick + 20 * 5;
  assert.equal(viewFor(g, 0, {}).weather.next, 'fog', 'the warning, which every player gets, is');
}

// A detached view contains no live player, unit, terrain, or visibility references.
{
  const g = createGame(aiMap(), ['AI', 'ally', 'enemy'], false, [0, 0, 1], [0, 1, 2]), memory = {}, before = aiDigest(g);
  const enemy = [...g.units.values()].find(u => u.owner === 2); g.players[0].visible.add(enemy.id);
  const state = aiDigest(g), view = viewFor(g, 0, memory);
  assert.equal(aiDigest(g), state, 'projecting a view does not change terrain memory or authoritative units');
  assert.equal(g.fog, undefined, 'a view builds no fog masks on the game'); assert.equal(g.players[0].fog, undefined, 'a view leaves the seat\'s fog state alone');
  assert.equal(view.players[2].mp, undefined, 'enemy economy is absent');
  assert.equal(view.players[1].mp, undefined, 'allied economy is absent');
  assert.notEqual(view.units, g.units, 'unit map is detached');
  for (const [id, unit] of view.units) assert.notEqual(unit, g.units.get(id), `unit ${id} is detached`);
  const target = { x: 10, z: 10 }, seen = view.sees(target), owned = [...view.units.values()].find(u => u.owner === 0);
  assert.equal(view.units.get(enemy.id).hp, Math.ceil(enemy.hp), 'enemy health uses snapshot precision');
  const rawHp = g.units.get(owned.id).hp; owned.hp = 1;
  assert.equal(g.units.get(owned.id).hp, rawHp, 'editing a projected unit cannot edit the simulation');
  view.players[0].mp = -100; assert.ok(g.players[0].mp >= 0, 'editing projected economy cannot edit the simulation');
  for (const u of g.units.values()) if (g.players[u.owner].team === 0) Object.assign(u, { x: 150, z: 150 });
  g.chars.fill('B'); g.flags.fill(sim.TERRAIN.B);
  assert.equal(view.sees(target), seen, 'visibility is computed solely from detached units and terrain');
  assert.notEqual(aiDigest(g), before, 'detachment test actually changed live state');
}

// Cached projection and public terrain updates preserve the same view contract.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]), memory = {}, old = viewFor(g, 0, memory);
  const cell = 40 * g.w + 40, oldChar = old.chars[cell]; massiveInternals.setCell(g, cell, 'T');
  const current = viewFor(g, 0, memory);
  assert.equal(current.chars[cell], 'T', 'nonbuilding terrain changes are public outside current vision');
  assert.equal(old.chars[cell], oldChar, 'a terrain update cannot change an already delivered view');
  const cache = snapshotCache(g), cached = viewFor(g, 0, {}, cache), uncached = viewFor(g, 0, {});
  assert.deepEqual({ ...cached, sees: undefined }, { ...uncached, sees: undefined }, 'shared snapshot caches preserve the complete projected view');
  assert.equal(cached.sees({ x: 10, z: 10 }), uncached.sees({ x: 10, z: 10 }), 'cached projection preserves visibility');
}

// Between delivered snapshots the planner must use its supplied earlier observation.
{
  const g = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]); g.players[0].mp = 1000;
  const memory = {}, delivered = viewFor(g, 0, memory), before = aiCommands(g, 0, structuredClone(memory), 319, { view: delivered });
  const tank = massiveInternals.spawnUnit(g, 1, 'tank'); Object.assign(tank, { x: 45, z: 5 }); g.players[0].visible.add(tank.id);
  g.strikes.push({ kind: 'strafe', owner: 1, x: 5, z: 5, dir: 0, t: 4, live: false, left: 1, next: 0 });
  assert.deepEqual(aiCommands(g, 0, structuredClone(memory), 319, { view: delivered }), before, 'an undelivered sighting and strike cannot change the next decision');
  const refreshed = viewFor(g, 0, structuredClone(memory));
  for (const level of AI_LEVEL_NAMES) {
    const beforeLevel = aiCommands(g, 0, {}, 319, { view: delivered, level });
    assert.deepEqual(aiCommands(g, 0, { seen: new Map([[tank.id, { type: 'tank', val: 99999 }]]) }, 319, { view: delivered, level }), beforeLevel, `${level} memory uses delivered sightings only`);
  }
  assert.notDeepEqual(aiCommands(g, 0, structuredClone(memory), 319, { view: refreshed }).commands, before.commands, 'delivery of the sighting and strike can change decisions');
  g.players[0].visible.delete(tank.id); g.tick = 1200; viewFor(g, 0, memory);
  assert.ok(!memory.still.has(tank.id), 'observed stationary tracking ends when current vision ends');
  const sightings = {}; g.tick = 0; g.players[0].visible.add(tank.id); viewFor(g, 0, sightings);
  g.players[0].visible.delete(tank.id); g.tick = 1200; viewFor(g, 0, sightings);
  assert.ok(sightings.seen.has(tank.id), 'a sighting remains for sixty seconds');
  g.tick = 1201; viewFor(g, 0, sightings);
  assert.ok(!sightings.seen.has(tank.id), 'sightings expire after sixty seconds even without adaptive planning');
}

// Exercise the real room tick's delivery ordering without opening a server port.
{
  const source = readFileSync('server.js', 'utf8');
  const body = source.slice(source.indexOf('function timedRoomTick(room)'), source.indexOf('export function tickRooms()'));
  for (const cadence of [2, 4]) {
    const decisions = [], deliveries = [];
    const tick = new Function('thinkEvery', 'step', 'think', 'observe', 'snapshotCache', 'snapshotFor', 'createTickMeter', 'recordTick', 'tickStats', 'trimmed',
      body + '\nreturn timedRoomTick;')(
      thinkEvery, g => { g.tick++; },
      (g, slot, opts) => { decisions.push([g.tick, slot, opts.view.tick]); },
      g => ({ tick: g.tick }), () => ({}), g => ({ tick: g.tick }), () => ({}), () => cadence, () => ({}), (room, net, msg) => msg);
    const game = { tick: 0, winner: null, shots: [], newCells: [] };
    const room = { game, snapEvery: cadence, aiViews: [{ tick: 0 }, { tick: 0 }, { tick: 0 }],
      players: [{ ws: { readyState: 1, send: raw => deliveries.push(JSON.parse(raw).tick) } }, { ai: true, level: 'easy' }, { ai: true, level: 'hard' }] };
    for (let i = 0; i < 161; i++) tick(room);
    assert.deepEqual(deliveries, Array.from({ length: Math.floor(161 / cadence) }, (_, i) => (i + 1) * cadence), 'humans keep the configured delivery beat');
    assert.ok(decisions.length >= 4, 'both staggered AI slots took turns');
    for (const [at, slot, viewed] of decisions) {
      assert.equal((at + slot * 13) % thinkEvery(room.players[slot].level), 0, 'AI schedule keeps the selected difficulty and server stagger');
      assert.equal(viewed, Math.floor(at / cadence) * cadence, 'AI sees only the most recent human delivery beat');
    }
    assert.ok(decisions.some(([at, , viewed]) => viewed < at), 'proof includes a turn between snapshots');
    // Slot 3 thinks at tick 1. A newly handed-over seat waits for its first delivery.
    const handover = { game: { tick: 0, winner: null, shots: [], newCells: [] }, snapEvery: cadence,
      aiViews: [null, null, null, null], players: [{}, {}, {}, { ai: true }] };
    const before = decisions.length; tick(handover);
    assert.equal(decisions.length, before, 'handover cannot plan from an undelivered observation');
  }
}

// Each perturbation below is only kept for a turn when the seat's human snapshot stays identical: a hidden building
// beside a visible enemy changes that enemy's public cover value, for example, so that world is not equivalent.
// Two seeds per mode exercise hidden perturbations across hundreds of real AI turns, in every mode the AI plays.
{
  const maps = { default: JSON.parse(readFileSync('maps/default.json', 'utf8')), 'hill-112': JSON.parse(readFileSync('maps/hill-112.json', 'utf8')) };
  // The same map without houses: holding squads have nowhere to garrison, so they entrench.
  maps.open = { ...maps.default, rows: maps.default.rows.map(row => row.replaceAll('B', '.')) };
  const originalRandom = Math.random;
  const counts = { comparisons: 0, commands: 0, hiddenUnits: 0, footprints: 0, depots: 0, visibleUnits: 0, digits: 0, hiddenMines: 0, dropped: 0 }, byType = {};
  const hordeSeats = new Set();
  try {
    for (const [mode, mapName, ticks] of [['conquest', 'default', 1600], ['conquest', 'open', 1600], ['classic', 'default', 1600], ['assault', 'default', 1600], ['horde', 'hill-112', 2600]]) for (const seed of [617, 902]) for (const level of AI_LEVEL_NAMES) {
      Math.random = aiRandom(seed);
      const names = mode === 'horde' ? ['AI 0', 'AI 1'] : ['AI 0', 'AI 1', 'AI 2'];
      const g = createGame(maps[mapName], names, true, names.map((_, i) => i), [0, 1, 2], { mode, defenderTeam: 0 });
      assert.equal(g.mode?.kind ?? 'conquest', mode, `${mode} fixture really runs ${mode}`);
      const seats = g.players.map(p => p.slot), memories = seats.map(() => ({})), views = memories.map((m, slot) => viewFor(g, slot, m));
      for (let tick = 0; tick < ticks && g.winner === null; tick++) {
        step(g);
        if (g.tick % 2 === 0) for (const slot of seats) views[slot] = viewFor(g, slot, memories[slot]);
        for (const slot of seats) if ((g.tick + slot * 13) % thinkEvery(level) === 0) {
          if (mode === 'horde' && slot === g.mode.slot) hordeSeats.add(`${seed}`);
          const visible = new Set(aiSnapshot(g, slot).units.map(u => u[0])), team = g.players[slot].team;
          const perturb = {
            economy(a) {
              for (const p of a.players) if (p.team !== team) {
                p.mp += 12345.67; p.mun = (p.mun ?? 0) + 891.2; p.fuel = (p.fuel ?? 0) + 765.4;
                for (const kind of Object.keys(p.sup)) p.sup[kind] += 97;
              }
            },
            hiddenUnits(a) {
              let index = 0, n = 0;
              for (const [id, u] of [...a.units]) if (a.players[u.owner].team !== team && !visible.has(id)) {
                n++;
                u.x = -10000 - index; u.z = -10000; u.hp = index % 2 ? 1 : UNITS[u.type].hpPer * UNITS[u.type].models;
                u.still = 1000; u.path = [{ x: 150, z: 150 }]; u.orders = [{ t: 'move', x: 140, z: 140 }];
                u.targetId = 999999; u.attackId = 999998; u.cd = 999; u.prog = 999;
                if (u.queue) u.queue = ['rifle', 'mg', 'tank'];
                if (u.air) Object.assign(u.air, { state: 'rearm', fuel: 0, ammo: 0, timer: 999 });
                if (!UNITS[u.type].building && index++ % 3 === 0) a.units.delete(id);
              }
              return n;
            },
            addedTank(a) {
              const foe = a.players.find(p => p.team !== team);
              if (foe) Object.assign(massiveInternals.spawnUnit(a, foe.slot, 'tank'), { x: -20000, z: -20000, hp: 1, still: 777 });
            },
            // enemies the seat can see still keep private state: stationary timers, queued paths, a stance, a mass entrenchment
            visibleUnits(a) {
              let n = 0;
              for (const u of a.units.values()) if (a.players[u.owner].team !== team && visible.has(u.id)) {
                Object.assign(u, { still: UNITS[u.type].camo ? u.still : 1000 - u.still, path: [{ x: 150, z: 150 }], orders: [{ t: 'move', x: 140, z: 140 }], retarget: 77, repath: 77, stuck: 3,
                  autoRetreat: !u.autoRetreat, holdFire: !u.holdFire, holdPos: !u.holdPos });
                n++;
              }
              return n;
            },
            // the digits below the wire precision
            digits(a) {
              let n = 0;
              for (const u of a.units.values()) if (a.players[u.owner].team !== team && visible.has(u.id)) {
                u.x = Math.round(u.x * 10) / 10; u.z = Math.round(u.z * 10) / 10; u.hp = Math.max(0.01, Math.ceil(u.hp) - 0.45); n++;
              }
              return n;
            },
            depots(a) {
              const foe = a.players.find(p => p.team !== team);
              let n = 0;
              for (const node of foe ? a.nodes ?? [] : []) if (!node.depot && !teamSees(g, team, node)) { node.depot = massiveInternals.placeBuilding(a, foe.slot, 'depot', node.c, true).id; n++; }
              return n;
            },
            // the weather plan beyond the ten second warning is hidden from every player
            futureWeather(a) {
              if (!a.weather) return 0;
              Object.assign(a.weather, { next: a.weather.now === 'fog' ? 'clear' : 'fog', at: a.tick + 20 * 3600 });
              return 1;
            },
            // enemy mines laid around the seat's units and points, on open ground, mud and road: the seat is never told of them
            hiddenMines(a) {
              const foe = a.players.find(p => p.team !== team);
              if (!foe) return 0;
              let n = 0;
              const around = [...a.units.values()].filter(u => a.players[u.owner].team === team && !UNITS[u.type].structure && !u.air).concat(a.points);
              for (const o of around) for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [10, 10], [-10, -10]]) {
                const c = Math.floor((o.z + dz) / CELL) * a.w + Math.floor((o.x + dx) / CELL);
                if (c >= 0 && c < a.chars.length && '.MD'.includes(a.chars[c]) && !a.mines.has(c)) { massiveInternals.setCell(a, c, 'N'); a.mines.set(c, foe.slot); n++; }
              }
              return n;
            },
            footprints(a) {
              const hiddenBuilding = [...g.units.values()].find(u => UNITS[u.type].building && g.players[u.owner].team !== team && !visible.has(u.id) && !teamSees(g, team, u));
              if (!hiddenBuilding) return 0;
              for (const cell of hiddenBuilding.cells) massiveInternals.setCell(a, cell, 'R');
              return 1;
            },
          };
          const same = a => { try { assert.deepEqual(aiSnapshot(a, slot), aiSnapshot(g, slot)); return true; } catch { return false; } };
          let altered = structuredClone(g), made = {};
          for (const [name, fn] of Object.entries(perturb)) made[name] = fn(altered) ?? 1;
          if (!same(altered)) {
            // keep only the perturbations that leave the seat's observations alone
            altered = structuredClone(g); made = {};
            for (const [name, fn] of Object.entries(perturb)) {
              const trial = structuredClone(altered), n = fn(trial) ?? 1;
              if (same(trial)) { altered = trial; made[name] = n; } else counts.dropped++;
            }
          }
          for (const [name, n] of Object.entries(made)) if (name in counts) counts[name] += n;
          aiEquivalent(g, altered, slot, memories[slot], seed * 10000 + g.tick * 3 + slot, `${mode} on ${mapName}, seed ${seed} tick ${g.tick} seat ${slot}`, [level]);
          counts.comparisons++;
          let expected = aiDigest(g);
          think(g, slot, { level, memory: memories[slot], view: views[slot], submit: cmd => {
            assert.equal(aiDigest(g), expected, 'AI changes no authoritative state before submitting a command');
            const result = command(g, slot, cmd); expected = aiDigest(g); counts.commands++; byType[cmd.t] = (byType[cmd.t] ?? 0) + 1; return result;
          } });
          assert.equal(aiDigest(g), expected, 'AI changes no authoritative state after its last command');
        }
      }
    }
  } finally { Math.random = originalRandom; }
  // Behavior changes can make these short replays finish mining before they start a trench. Guarantee that the
  // same hidden-state proof also exercises entrenchment, with enough manpower to dig but not to mine first.
  const holder = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1]);
  const squad = [...holder.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  Object.assign(squad, { x: holder.points[0].x, z: holder.points[0].z });
  holder.points[0].owner = 0; holder.players[0].mp = 95;
  const privateEconomy = structuredClone(holder); privateEconomy.players[1].mp += 12345;
  const holderCommands = aiEquivalent(holder, privateEconomy, 0, {}, 5, 'the entrenching holder ignores hidden enemy resources');
  assert.ok(holderCommands.some(cmd => cmd.t === 'entrench'), 'the deterministic holder issues entrenchment');
  for (const cmd of holderCommands) {
    command(holder, 0, cmd); counts.commands++; byType[cmd.t] = (byType[cmd.t] ?? 0) + 1;
  }
  counts.comparisons++;
  assert.ok(counts.comparisons >= 600, `checked ${counts.comparisons} paired turns`);
  assert.ok(counts.commands >= 100 && counts.hiddenUnits >= 100 && counts.footprints > 0 && counts.depots > 0 && counts.visibleUnits >= 100 && counts.digits >= 100 && counts.hiddenMines >= 100,
    'proof exercised actual orders, hidden armies, private footprints, secret depots, hidden mines and visible enemies\' private state');
  // no stance orders here: auto-retreat starts on, so the AI has nothing to switch
  assert.ok(byType.entrench > 0, `the matches exercised entrenchment orders (${JSON.stringify(byType)})`);
  assert.equal(hordeSeats.size, 2, 'the Horde seat itself planned through the view in both Horde runs');
  console.log(`AI fog proofs: ${counts.comparisons} paired turns, ${counts.commands} command-only orders (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}), ${counts.hiddenUnits} hidden-unit, ${counts.visibleUnits} visible-unit, ${counts.digits} sub-precision and ${counts.depots} secret-depot and ${counts.hiddenMines} hidden-mine perturbations, ${counts.dropped} dropped as visible`);
}

// Replay an AI seat's actual commands as a human: income, payments, queues and limits stay equal.
{
  const originalRandom = Math.random;
  try {
    for (const mode of ['conquest', 'classic', 'assault']) {
      const ai = createGame(aiMap(), ['AI', 'enemy'], false, [0, 1], [0, 1], { mode, defenderTeam: 0 });
      Object.assign(ai.players[0], { mp: 5000, mun: 1000, fuel: 1000 });
      if (mode === 'classic') {
        const hq = [...ai.units.values()].find(u => u.owner === 0 && u.type === 'hq');
        massiveInternals.placeBuilding(ai, 0, 'barracks', 10 * ai.w + 2, true);
        massiveInternals.placeBuilding(ai, 0, 'motorpool', 10 * ai.w + 12, true);
        const node = ai.nodes[0], depot = massiveInternals.placeBuilding(ai, 0, 'depot', node.c, true); node.depot = depot.id;
        assert.ok(hq.queue, 'Classic parity fixture has production buildings');
      }
      const human = structuredClone(ai), memory = {};
      const submit = cmd => {
        const a = command(ai, 0, cmd), b = command(human, 0, structuredClone(cmd));
        assert.equal(a, b, `${mode}: human and AI get the same command result`);
        assert.equal(aiDigest(ai), aiDigest(human), `${mode}: human and AI commands have identical costs and state changes`);
        return a;
      };
      for (let tick = 0; tick < 400; tick++) {
        Math.random = aiRandom(7700 + tick); step(ai);
        Math.random = aiRandom(7700 + tick); step(human);
        assert.equal(aiDigest(ai), aiDigest(human), `${mode}: controller has no effect on income or cooldowns`);
        if (ai.tick % 40 === 0) think(ai, 0, { memory, submit });
      }
      const rifle = [...ai.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
      submit({ t: 'stop', ids: [rifle.id] });
      rifle.cd = human.units.get(rifle.id).cd = 0;
      const ability = { t: 'ability', ids: [rifle.id], x: Math.min(ai.w * CELL - 1, rifle.x + 4), z: rifle.z };
      const munBefore = ai.players[0].mun;
      assert.equal(submit(ability), undefined, `${mode}: both controllers can request a ready grenade`);
      Math.random = aiRandom(8300); step(ai);
      Math.random = aiRandom(8300); step(human);
      assert.equal(aiDigest(ai), aiDigest(human), `${mode}: grenade payment and cooldown are identical`);
      assert.ok(rifle.cd > 0, `${mode}: a thrown grenade starts its normal cooldown`);
      assert.equal(submit(ability), 'cooldown', `${mode}: ability cooldown blocks both controllers`);
      if (mode === 'classic') {
        assert.ok(ai.players[0].mun < munBefore, 'Classic: both controllers paid Munitions for the grenade');
        rifle.cd = human.units.get(rifle.id).cd = 0;
        ai.players[0].mun = human.players[0].mun = 0;
        assert.equal(submit(ability), 'mun', 'Classic: neither controller can use a paid ability without Munitions');
        ai.players[0].mun = human.players[0].mun = 1000;
      } else assert.equal(ai.players[0].mun, munBefore, `${mode}: abilities use the same free price`);
      ai.players[0].sup.recon = human.players[0].sup.recon = 0;
      assert.equal(submit({ t: 'support', kind: 'recon', x: 10, z: 10 }), undefined, `${mode}: support is paid normally`);
      assert.equal(submit({ t: 'support', kind: 'recon', x: 10, z: 10 }), 'cooldown', `${mode}: support cooldown blocks both controllers`);
      ai.players[0].mp = human.players[0].mp = 0;
      assert.equal(submit({ t: 'buy', unit: 'rifle' }), 'mp', `${mode}: neither controller buys without manpower`);
      ai.players[0].mp = human.players[0].mp = 10000;
      if (mode === 'classic') {
        ai.players[0].fuel = human.players[0].fuel = 0;
        assert.equal(submit({ t: 'buy', unit: 'tank' }), 'fuel', 'Classic: neither controller bypasses fuel');
        const hq = [...ai.units.values()].find(u => u.owner === 0 && u.type === 'hq');
        hq.queue = Array(5).fill('rifle'); human.units.get(hq.id).queue = [...hq.queue];
        assert.equal(submit({ t: 'buy', unit: 'engineer' }), 'queueFull', 'Classic: neither controller bypasses the production queue limit');
      }
      const template = [...ai.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
      while (popOf(ai, 0) < popCap(ai)) {
        const id = ai.nextId++; human.nextId = ai.nextId;
        const unit = { ...structuredClone(template), id }; ai.units.set(id, unit); human.units.set(id, structuredClone(unit));
      }
      assert.equal(submit({ t: 'buy', unit: 'rifle' }), 'pop', `${mode}: army cap applies to both controllers`);
    }
  } finally { Math.random = originalRandom; }
}

// Real map loads for 3 players, all spawns start with their force.
{
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b', 'c']);
  assert.equal(g.units.size, 9);
  run(g, 5);
}
// Three AIs play a full match on the real map: they must capture, fight, and finish.
{
  const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b', 'c']);
  let spawned = g.nextId, t0 = performance.now(), capturedAt = 0;
  for (let i = 0; i < 20 * 60 * 40 && g.winner === null; i++) {
    for (let s = 0; s < 3; s++) if ((g.tick + s * 13) % 40 === 0) think(g, s);
    step(g);
    if (!capturedAt && g.points.every(p => p.owner >= 0)) capturedAt = g.tick / 20;
  }
  const secs = g.tick / 20, bought = g.nextId - spawned, dead = g.nextId - 1 - g.units.size;
  console.log(`AI match: winner ${g.winner} after ${Math.round(secs)}s, all points taken at ${Math.round(capturedAt)}s, ${bought} bought, ${dead} killed, VP ${g.players.map(p => Math.floor(p.vp))}, sim ${Math.round((performance.now() - t0) / g.tick * 1000)}µs/tick`);
  assert.ok(capturedAt > 0 && capturedAt < 180, 'AIs take every point within 3 minutes');
  assert.ok(dead >= 5, 'AIs actually fight');
  assert.notEqual(g.winner, null, 'match ends within 30 minutes');
  assert.ok(g.story.every(s => s.mpSpent > 0) && g.story.some(s => s.kills > 0 && s.captures > 0), 'the story counts the match');
  assert.ok(g.timeline.length >= secs / 10, 'and samples it every 10 s');
}

// The end of a match (shared/story.js, finish() in sim.js, holdEnding() in server.js): every win records why and where,
// the story counts what each player did, and the server holds the ending for 6 s before the lobby shows the result.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const near = (a, b) => Math.abs(a.x - b.x) < 0.11 && Math.abs(a.z - b.z) < 0.11;
  // Conquest: VP; the decisive spot is the point the winners took last
  const g = fresh(Array(60).fill('.'.repeat(60))); g.players[0].mp = g.players[1].mp = 1000;
  const pt = g.points[0], mp0 = g.players[0].mp, r = put(g, 0, 'rifle', pt.x, pt.z), e = put(g, 1, 'rifle', 110, 110);
  assert.equal(g.story[0].mpSpent, mp0 - g.players[0].mp, 'the story counts manpower spent');
  run(g, CFG.captureTime + 1);
  assert.equal(pt.owner, 0); assert.equal(g.story[0].captures, 1, 'and captures');
  assert.ok(!snapshotFor(g, 0, []).units.some(u => u[0] === e.id), 'fog holds while the match is on');
  assert.equal(snapshotFor(g, 0, []).end, undefined, 'no end data before the winner');
  assert.equal(g.timeline[0].t, 0); assert.equal(g.timeline[0].vp.length, 2, 'the timeline starts at 0 s with VP per team');
  g.players[0].vp = g.winVp - 0.01; run(g, 1);
  assert.equal(g.winner, 0); assert.equal(g.endReason, 'vp');
  assert.ok(near(g.endAt, pt), 'a VP win ends on the point the winners took last');
  const snap = snapshotFor(g, 0, []);
  assert.deepEqual(snap.end, { reason: 'vp', x: g.endAt.x, z: g.endAt.z });
  assert.ok(snap.units.some(u => u[0] === e.id) && snap.units.length === g.units.size, 'once decided, everyone sees everything');
  // after the winner the sim runs on (the server's hold) but orders, the story and the timeline stop
  const samples = g.timeline.length, ids = g.nextId;
  command(g, 1, { t: 'buy', unit: 'rifle' }); command(g, 1, { t: 'move', orders: [[e.id, 30, 30]] });
  assert.equal(g.nextId, ids, 'no buying after the end'); assert.equal(e.path.length, 0, 'no orders after the end');
  r.hp = 0; run(g, 11);
  assert.ok(!g.units.has(r.id), 'the sim still runs after the end');
  assert.equal(g.story[0].losses, 0, 'nothing counts after the end');
  assert.equal(g.timeline.length, samples, 'and the timeline stops');
  assert.equal(g.winner, 0, 'the winner never changes');

  // Assault: the last structure falling, or the clock
  const as = () => createGame(map, ['att', 'def'], false, [0, 1], [0, 1], { mode: 'assault', defenderTeam: 1 });
  const a = as(), structs = [...a.units.values()].filter(u => UNITS[u.type].structure), last = structs.at(-1);
  structs.slice(0, -1).forEach(s => (s.hp = 0)); run(a, 0.1);
  assert.equal(a.winner, null, 'a structure still stands');
  last.hp = 0; run(a, 0.1);
  assert.equal(a.winner, 0); assert.equal(a.endReason, 'structures');
  assert.ok(near(a.endAt, last), 'it ends where the last structure fell');
  const t = as(); t.mode.timeLeft = 0.01; run(t, 0.1);
  assert.equal(t.winner, 1); assert.equal(t.endReason, 'timer');
  assert.deepEqual(t.endAt, { x: t.w * CELL / 2, z: t.h * CELL / 2 }, 'a timer win ends over the middle of the map');

  // Annihilation: the last bunker; all of them at once is a draw
  const an = () => createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 1], [0, 1, 2, 0], { mode: 'annihilation' });
  const n = an(), bunker = (gg, o) => [...gg.units.values()].find(u => u.type === 'bunker' && u.owner === o);
  bunker(n, 2).hp = 0; run(n, 0.1);
  const b3 = bunker(n, 3); b3.hp = 0; run(n, 0.1);
  assert.equal(n.winner, 0); assert.equal(n.endReason, 'bunkers'); assert.ok(near(n.endAt, b3), 'it ends at the last bunker');
  assert.equal(n.story[0].losses + n.story[1].losses, 0); assert.equal(n.story[2].losses + n.story[3].losses, 2, 'bunkers count as losses');
  const d = an(); for (const u of d.units.values()) if (u.type === 'bunker') u.hp = 0;
  run(d, 0.1);
  assert.equal(d.winner, -1); assert.equal(d.endReason, 'draw', 'every bunker down together: a draw');
  assert.ok(d.timeline.at(-1).points && d.timeline.at(-1).structures.every(v => v === 0), 'the timeline counts points and structures');

  // Classic: the last Production Building
  const c = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' }), hq = [...c.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  hq.hp = 0; run(c, 0.1);
  assert.equal(c.winner, 0); assert.equal(c.endReason, 'hq'); assert.ok(near(c.endAt, hq), 'it ends at the fallen HQ');

  // the counters: kills and losses, support calls, planes downed, field works
  const k = fresh(); k.players[0].mp = k.players[1].mp = 1000;
  put(k, 0, 'rifle', 5, 5); const victim = put(k, 1, 'rifle', 15, 5); victim.hp = 1;
  run(k, 5);
  assert.ok(!k.units.has(victim.id)); assert.equal(k.story[0].kills, 1); assert.equal(k.story[1].losses, 1);
  assert.equal(k.story[0].losses + k.story[1].kills, 0, 'kills and losses go to the right players');
  const fc = fresh(); fc.players[0].mp = fc.players[1].mp = 2000;
  put(fc, 1, 'tank', 30, 30); run(fc, 0.2);
  command(fc, 1, { t: 'support', kind: 'cover', x: 30, z: 30 }); run(fc, SUPPORT.cover.delay + 0.2);
  command(fc, 0, { t: 'support', kind: 'dive', x: 30, z: 30 }); run(fc, SUPPORT.dive.delay + 0.5);
  assert.deepEqual(fc.story.map(s => s.supportCalls), [1, 1], 'support calls');
  assert.equal(fc.story[1].planesDowned, 1, 'fighter cover downing a dive bomber');
  assert.equal(fc.story[1].mpSpent, UNITS.tank.cost + SUPPORT.cover.cost);
  const dg = fresh(); dg.players[0].mp = 1000;
  const digger = put(dg, 0, 'rifle', 20, 20);
  command(dg, 0, { t: 'dig', ids: [digger.id], x: 20, z: 20 }); run(dg, CFG.digTime * CFG.digCells + 5);
  assert.equal(digger.dig, null); assert.equal(dg.story[0].built, 1, 'a finished trench counts as built');
}

// Server tests share one in-process server.js on a free port (PORT=0). Its tick loop is stopped: tests call tick().
// Every serverHarness() call gets a fresh fake clock for timers, pauses and denial limits, and its own clients.
// close() ends that block's clients and rooms; stopServerHarness() at the end of the file closes the server.
// holdMaps() pauses map file reads (to expose async races) and useMap() serves a fixture map; close() restores the disk.
// A client's late() delivers a message on its server-side socket even after the server replaced or closed it.
function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = until;
    },
  };
}
let serverModule = null;
async function serverHarness() {
  serverModule ??= (async () => {
    const env = { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' }; // no .edit-password file, no tailscale call
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    let module;
    try { module = await import('./server.js'); }
    finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    clearInterval(module.loop);
    if (!module.server.listening) await new Promise((resolve, reject) => { module.server.once('listening', resolve); module.server.once('error', reject); });
    // Server-side sockets in accept order; connect() waits for its own (clients connect one at a time).
    const accepting = [];
    module.wss.on('connection', ws => accepting.shift()?.(ws));
    return { module, accepting, originalClock: { ...module.clock }, originalMaps: { ...module.mapFiles } };
  })();
  const { module, accepting, originalMaps } = await serverModule;
  const { default: WebSocket } = await import('ws');
  const clock = fakeClock(), clients = [];
  Object.assign(module.clock, clock);
  Object.assign(module.mapFiles, originalMaps);
  let mapGate = null;
  const settleServer = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setTimeout(resolve, 4));
    await new Promise(resolve => setImmediate(resolve));
  };
  // real-time limit: generous because starting a Massive six-army match can take seconds on a loaded machine
  const waitFor = async (predicate, label) => {
    const until = Date.now() + (+process.env.WW2_TEST_WAIT_MS || 15000);
    for (;;) {
      const result = predicate();
      if (result) return result;
      assert.ok(Date.now() < until, label);
      await settleServer();
    }
  };
  const connect = async (code, { token = 'token-' + clients.length, name = 'Soldier', hello = true } = {}) => {
    const serverSide = new Promise(resolve => accepting.push(resolve));
    // no compression: zlib runs off the main thread, and settleServer's few milliseconds assume a message is sent at once
    const ws = new WebSocket(`ws://127.0.0.1:${module.server.address().port}/ws?room=${code}`, { perMessageDeflate: false });
    const messages = [], errors = [];
    const client = {
      code, token, ws, messages, log: messages, errors, closed: false, serverSide,
      async send(message) { await new Promise((resolve, reject) => ws.send(JSON.stringify(message), error => error ? reject(error) : resolve())); await settleServer(); },
      async late(message) { (await serverSide).emit('message', Buffer.from(JSON.stringify(message)), false); await settleServer(); },
      lobby: () => messages.filter(message => message.t === 'lobby').at(-1),
      async close() { if (ws.readyState !== 3) ws.close(); await waitFor(() => client.closed, 'client closes'); await settleServer(); },
      wait(type, predicate = () => true, after = 0) { return waitFor(() => messages.slice(after).find(message => message.t === type && predicate(message)), `client receives ${type}`); },
    };
    // snapshots carry changed unit rows, gone ids and the wrecks and nodes only when they change: rebuild them as client/main.js does
    const rows = new Map(); let prev = null;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.t === 'start') { rows.clear(); prev = null; }
      if (m.t === 's') {
        for (const id of m.gone ?? []) rows.delete(id);
        for (const row of m.units) rows.set(row[0], row);
        m.sent = m.units; m.units = [...rows.values()]; m.wrecks ??= prev?.wrecks; m.nodes ??= prev?.nodes; prev = m;
      }
      messages.push(m);
    });
    ws.on('close', () => { client.closed = true; });
    ws.on('error', error => errors.push(error)); clients.push(client);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    if (!hello) return client;
    await client.send({ t: 'hello', token, name });
    await waitFor(() => messages.find(message => ['lobby', 'full'].includes(message.t)), 'hello is answered');
    return client;
  };
  return {
    clock, connect, settleServer, waitFor, rooms: module.rooms,
    game: code => module.rooms.get(code)?.game,
    snapshots: client => client.messages.filter(message => message.t === 's'),
    async tick(n = 1) { for (let i = 0; i < n; i++) module.tickRooms(); await settleServer(); },
    holdMaps() {
      let open; mapGate = new Promise(resolve => (open = resolve)); mapGate.open = open;
      const read = module.mapFiles.read, gate = mapGate;
      module.mapFiles.read = async (name) => { await gate; return read(name); };
    },
    releaseMaps() { mapGate?.open(); mapGate = null; },
    useMap(json) { module.mapFiles.read = async () => json; },
    async clear(code) { await Promise.all(clients.filter(client => client.code === code && !client.closed).map(client => client.close())); module.rooms.delete(code); },
    async close() {
      mapGate?.open(); mapGate = null; Object.assign(module.mapFiles, originalMaps);
      await Promise.all(clients.filter(client => !client.closed).map(client => client.close()));
      for (const code of new Set(clients.map(client => client.code))) module.rooms.delete(code);
    },
  };
}
async function stopServerHarness() {
  if (!serverModule) return;
  const { module, originalClock, originalMaps } = await serverModule;
  for (const ws of module.wss.clients) ws.terminate();
  module.rooms.clear(); Object.assign(module.clock, originalClock); Object.assign(module.mapFiles, originalMaps);
  await new Promise(resolve => module.wss.close(() => resolve()));
  if (module.server.listening) await new Promise(resolve => module.server.close(resolve));
}

// Round 2 server checks, on the shared harness.
// Server: repeated hello messages must not race initialization or close their own connection.
{
  const h = await serverHarness(), code = 'rehello';
  const p = await h.connect(code, { hello: false }); h.holdMaps();
  const first = p.send({ t: 'hello', token: 'host', name: 'Host' });
  const again = p.send({ t: 'hello', token: 'host', name: 'Host' });
  h.releaseMaps(); await Promise.all([first, again]); await p.wait('lobby');
  assert.equal(p.closed, false, 'server repeated hello keeps its connection open');
  assert.equal(p.lobby().players.length, 1, 'server repeated hello occupies one player slot');
  await h.close();
}

// Server: a replaced or departed socket cannot keep controlling its old player slot.
{
  const h = await serverHarness(), code = 'replaced';
  const old = await h.connect(code, { token: 'host', name: 'Old' });
  const current = await h.connect(code, { token: 'host', name: 'Current' });
  await old.late({ t: 'name', name: 'Stale' });
  assert.equal(current.lobby().players[0].name, 'Current', 'server replaced socket cannot rename its former player');
  await h.connect(code, { token: 'guest', name: 'Guest' });
  await current.send({ t: 'start' }); await current.wait('start');
  const before = h.game(code).units.size;
  await current.send({ t: 'leave' });
  await current.late({ t: 'buy', unit: 'rifle' });
  assert.equal(h.game(code).units.size, before, 'server departed socket cannot buy for the AI that took over');
  await h.close();
}

// Server: a map request still awaiting disk cannot change settings once the match has started.
for (const lookupFinished of [false, true]) {
  const h = await serverHarness(), code = 'pending' + (lookupFinished ? 1 : 0);
  const p = await h.connect(code, { token: 'host', name: 'Host' }); h.holdMaps();
  const map = p.send({ t: 'map', name: 'river-towns' });
  if (lookupFinished) await h.settleServer();
  const start = p.send({ t: 'start' }); await h.settleServer();
  h.releaseMaps(); await Promise.all([map, start]); await h.settleServer();
  assert.equal(p.lobby().mapName, 'default', `server pending map ${lookupFinished ? 'load' : 'lookup'} cannot change a started match`);
  await h.close();
}

// Server: ending a match while its map loads must cancel that start.
{
  const h = await serverHarness(), code = 'cancelstart';
  const p = await h.connect(code, { token: 'host', name: 'Host' }); h.holdMaps();
  const start = p.send({ t: 'start' });
  await p.send({ t: 'end' });
  h.releaseMaps(); await start; await h.settleServer();
  assert.equal(p.messages.filter(m => m.t === 'start').length, 0, 'server cancelled start never sends players back into play');
  assert.equal(p.lobby().state, 'lobby', 'server cancelled start keeps the lobby open');
  assert.deepEqual(p.lobby().result, { ended: true, you: null }, 'server cancelled start preserves the host end result');
  await h.close();
}

// Server: player-slot commands require numeric integer slots, without string or array coercion.
{
  const h = await serverHarness(), code = 'slots';
  const p = await h.connect(code, { token: 'host', name: 'Host' });
  await p.send({ t: 'addAi' });
  for (const slot of ['1', [1], 1.5, -1, null, true]) {
    await p.send({ t: 'faction', slot, v: 2 });
    assert.equal(p.lobby().players[1].faction, 1, 'server malformed faction slot is ignored');
    await p.send({ t: 'team', slot, v: 4 });
    assert.equal(p.lobby().players[1].team, 1, 'server malformed team slot is ignored');
    await p.send({ t: 'kick', slot });
    assert.equal(p.lobby().players.length, 2, 'server malformed kick slot is ignored');
  }
  await p.send({ t: 'faction', slot: 1, v: 2 });
  assert.equal(p.lobby().players[1].faction, 2, 'server valid integer faction slot still works');
  await p.send({ t: 'kick', slot: 1 });
  assert.equal(p.lobby().players.length, 1, 'server valid integer kick slot still works');
  await h.close();
}

// Server: the host picks each AI seat's difficulty in the lobby. Humans have none; bad values and guests are ignored.
{
  const h = await serverHarness(), code = 'levels';
  const host = await h.connect(code, { token: 'host', name: 'Host' }), guest = await h.connect(code, { token: 'guest', name: 'Guest' });
  await host.send({ t: 'addAi' });
  // lobby updates are sent after an async map listing, so wait for the one a change produces
  await h.waitFor(() => host.lobby().players.length === 3, 'server the AI seat is added');
  const level = (slot) => host.lobby().players[slot].level;
  assert.equal(level(2), 'normal', 'server new AI seat plays Normal');
  assert.equal(level(0), null, 'server human seat has no difficulty');
  await host.send({ t: 'level', slot: 2, v: 'hard' });
  await h.waitFor(() => level(2) === 'hard', 'server host sets an AI seat to Hard');
  for (const v of ['brutal', 2, null, 'constructor', 'toString', '__proto__']) await host.send({ t: 'level', slot: 2, v });
  assert.equal(level(2), 'hard', 'server unknown difficulty is ignored');
  for (const slot of ['2', [2], 2.5, -1, null, true]) await host.send({ t: 'level', slot, v: 'easy' });
  assert.equal(level(2), 'hard', 'server malformed difficulty slot is ignored');
  await host.send({ t: 'level', slot: 1, v: 'easy' });
  assert.equal(level(1), null, 'server a human seat gets no difficulty');
  await guest.send({ t: 'level', slot: 2, v: 'easy' });
  assert.equal(level(2), 'hard', 'server only the host sets difficulty');
  await host.send({ t: 'start' }); await host.wait('start');
  await host.send({ t: 'level', slot: 2, v: 'easy' });
  assert.equal(level(2), 'hard', 'server difficulty is fixed once the match starts');
  await h.close();
}

// Server: JSON objects masquerading as names or tokens cannot crash text conversion.
{
  const h = await serverHarness(), code = 'badtext', invalid = { toString: null, valueOf: null };
  const p = await h.connect(code, { hello: false });
  for (const field of ['token', 'name']) {
    await p.send({ t: 'hello', token: 'host', name: 'Host', [field]: invalid });
    assert.equal(p.messages.length, 0, 'server malformed hello text does not claim a player slot');
    assert.equal(p.closed, false, `server malformed hello ${field} does not throw`);
  }
  await p.send({ t: 'hello', token: 'host', name: 'Host' }); await p.wait('lobby');
  await p.send({ t: 'name', name: invalid });
  assert.equal(p.closed, false, 'server malformed rename does not throw');
  assert.equal(p.lobby().players[0].name, 'Host', 'server malformed rename preserves the player name');
  await h.close();
}

// Server: Massive rooms construct snapshots only for sockets that can receive them.
{
  const map = { name: 'Massive fixture', w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [5, 75].flatMap(y => [5, 40, 75].map(x => ({ x, y }))), points: [{ x: 40, y: 40 }] };
  const h = await serverHarness(), code = 'massive'; h.useMap(JSON.stringify(map));
  const p = await h.connect(code, { token: 'host', name: 'Host' });
  await p.send({ t: 'map', name: 'default' }); // seats follow the fixture's six spawns
  for (let i = 0; i < 5; i++) await p.send({ t: 'addAi' });
  await p.send({ t: 'army', v: 'massive' }); await p.send({ t: 'start' }); await p.wait('start');
  const g = h.game(code);
  for (let slot = 0; slot < 6; slot++) {
    g.players[slot].mp = 50000;
    for (let i = 0; i < 42; i++) command(g, slot, { t: 'buy', unit: 'rifle' });
  }
  assert.equal(g.units.size, 270, 'server snapshot fixture fields 270 units');
  // Each snapshot built for a socket is serialized once, so counting snapshot serializations counts the builds.
  const stringify = JSON.stringify, built = async (ticks) => {
    let n = 0;
    JSON.stringify = function (value, ...rest) { if (value?.t === 's') n++; return stringify.call(this, value, ...rest); };
    try { await h.tick(ticks); } finally { JSON.stringify = stringify; }
    return n;
  };
  assert.equal(await built(2), 1, 'server constructs one snapshot for one connected human and five AIs');
  const socket = await p.serverSide;
  Object.defineProperty(socket, 'readyState', { value: 2, configurable: true });
  try { assert.equal(await built(2), 0, 'server constructs no snapshot for a socket that is closing'); }
  finally { delete socket.readyState; }
  await h.close();
}

// Server: only the host picks the weather, from the known choices, and the match starts with it.
{
  const h = await serverHarness(), code = 'weather';
  const p = await h.connect(code, { token: 'host', name: 'Host' }), q = await h.connect(code, { token: 'guest', name: 'Guest' });
  await q.wait('lobby');
  assert.equal(p.lobby().weather, 'map', 'server lobby starts on the map default weather');
  await p.send({ t: 'weather', v: 'fog' });
  assert.equal(q.lobby().weather, 'fog', 'server host weather pick reaches everyone');
  await q.send({ t: 'weather', v: 'snow' });
  await p.send({ t: 'weather', v: 'hail' });
  await p.send({ t: 'weather', v: { toString: null } });
  assert.equal(p.lobby().weather, 'fog', 'server ignores a guest or unknown weather pick');
  await p.send({ t: 'start' });
  const start = await q.wait('start');
  assert.deepEqual(start.weather, ['fog'], 'server start message carries the weather');
  assert.equal(h.game(code).weather.now, 'fog', 'server match runs in the picked weather');
  await h.tick(2);
  assert.deepEqual(q.messages.filter(m => m.t === 's').at(-1)?.weather, ['fog'], 'server snapshots carry the weather');
  await p.send({ t: 'weather', v: 'clear' });
  assert.equal(h.game(code).weather.now, 'fog', 'server weather cannot change mid-match');
  await h.close();
}

// Server: building footprints under fog stay out of the start and reconnect terrain.
{
  const map = { name: 'Footprint fixture', w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 2, y: 2 }, { x: 77, y: 77 }], points: [{ x: 40, y: 40 }] };
  const h = await serverHarness(), code = 'footprint'; h.useMap(JSON.stringify(map));
  const p = await h.connect(code, { token: 'host', name: 'Host' });
  await h.connect(code, { token: 'guest', name: 'Guest' });
  await p.send({ t: 'mode', v: 'classic' }); await p.send({ t: 'start' });
  const enemyHq = [...h.game(code).units.values()].find(u => u.owner === 1 && u.type === 'hq');
  assert.ok(!(await p.wait('start')).cells.some(([c]) => enemyHq.cells.includes(c)), 'server initial terrain excludes unseen enemy HQ footprints');
  const returning = await h.connect(code, { token: 'host', name: 'Host' });
  assert.ok(!(await returning.wait('start')).cells.some(([c]) => enemyHq.cells.includes(c)), 'server reconnect terrain excludes unseen enemy HQ footprints');
  await h.close();
}

// The server's side of the end, in-process: the 6 s hold (half speed, orders refused, AIs idle, fog lifted), then the
// lobby with the result and each player's own outcome. Real WebSocket clients against the shared server harness.
{
  const h = await serverHarness();
  const lobbies = (c) => c.messages.filter(m => m.t === 'lobby');
  const ticksUntil = async (fn, what, max = 2000) => { for (let i = 0; !fn(); i++) { assert.ok(i < max, 'timed out: ' + what); await h.tick(); } };
  const setUp = async (code, names) => {
    const people = [];
    for (const nm of names) people.push(await h.connect(code, { token: code + nm, name: nm }));
    const room = h.rooms.get(code), host = people[0], ai = names.length;
    await host.send({ t: 'addAi' }); assert.equal(room.players.length, ai + 1, 'AI added');
    await host.send({ t: 'team', slot: ai, v: 1 }); await host.send({ t: 'mode', v: 'annihilation' });
    assert.ok(room.mode === 'annihilation' && room.players[ai].team === 1, 'settings');
    await host.send({ t: 'start' }); await host.wait('start');
    await ticksUntil(() => h.snapshots(host).length, 'match started');
    return { room, g: room.game, people };
  };
  const decided = (room) => ticksUntil(() => room.game.winner !== null, 'a winner');
  const backInLobby = (room, c) => ticksUntil(() => room.state === 'lobby' && lobbies(c).at(-1)?.result?.story, 'the lobby result', 400);

  // win and loss: Ann (team 0) against Ben and an AI (team 1)
  {
    const { room, g, people: [ann, ben] } = await setUp('endwin', ['Ann', 'Ben']);
    // Count AI command attempts. Observation refreshes can also run while thinking is idle.
    let thinks = 0;
    let aiMp = g.players[2].mp;
    Object.defineProperty(g.players[2], 'mp', { get() { if (/at think /.test(new Error().stack)) thinks++; return aiMp; }, set(value) { aiMp = value; }, configurable: true, enumerable: true });
    await ticksUntil(() => thinks > 0, 'the AI thinks during the match');
    const mine = () => [...g.units.values()].filter(u => u.owner === 0).length, before = mine();
    await ann.send({ t: 'buy', unit: 'rifle' }); assert.equal(mine(), before + 1, 'orders work during the match');
    await h.tick(3);
    const seenByAnn = new Set(h.snapshots(ann).flatMap(s => s.units.map(u => u[0])));
    const hidden = [...g.units.values()].find(u => g.players[u.owner].team === 1 && !UNITS[u.type].structure && !seenByAnn.has(u.id));
    assert.ok(hidden, 'an enemy unit Ann never saw: the fog holds while the match is on');
    assert.ok([...h.snapshots(ann), ...h.snapshots(ben)].every(s => s.end === undefined && s.winner === null && !('story' in s) && !('timeline' in s)), 'no end data while the match is on');
    assert.equal(lobbies(ann).at(-1).result, null, 'no result while the match is on');
    const nSnaps = h.snapshots(ann).length, nBenSnaps = h.snapshots(ben).length;
    const seenByBen = new Set(h.snapshots(ben).flatMap(s => s.units.map(u => u[0])));
    const hiddenSurvivor = [...g.units.values()].find(u => u.owner === 0 && !UNITS[u.type].structure && !seenByBen.has(u.id));
    assert.ok(hiddenSurvivor, 'the losing player has not seen a surviving enemy squad');
    const benUnit = [...g.units.values()].find(u => u.owner === 1 && !UNITS[u.type].structure);
    for (const u of g.units.values()) if (u.type === 'bunker' && g.players[u.owner].team === 1) u.hp = 0;
    await decided(room);
    const winTick = g.tick, thought = thinks, ids = g.nextId;
    assert.equal(g.winner, 0); assert.equal(g.endReason, 'bunkers');
    // the hold: orders refused, everything in sight
    await ben.send({ t: 'buy', unit: 'rifle' }); await ben.send({ t: 'move', orders: [[benUnit.id, 5, 5]] });
    await h.tick(6);
    assert.equal(room.state, 'play', 'the match holds before the lobby');
    assert.equal(g.nextId, ids, 'no buying during the hold');
    assert.equal(g.units.has(benUnit.id), false, 'the defeated army stays removed during the hold');
    assert.equal(snapshotFor(g, 0, []).units.length, g.units.size, 'full vision during the hold');
    await backInLobby(room, ann);
    assert.equal(thinks, thought, 'the AI stops thinking during the hold');
    assert.equal(g.tick - winTick, 60, 'the hold runs the sim at half speed: 60 steps in 6 s');
    const held = h.snapshots(ann).slice(nSnaps);
    assert.ok(held.length >= 55 && held.every(s => s.winner === 0 && s.end.reason === 'bunkers'), 'snapshots carry the end through the hold');
    assert.ok(held.every(s => !s.units.some(u => u[0] === hidden.id)), 'defeated enemy units do not reappear during the ending');
    assert.ok(h.snapshots(ben).slice(nBenSnaps).some(s => s.units.some(u => u[0] === hiddenSurvivor.id)), 'the losing player sees surviving enemy units when fog lifts');
    const ra = lobbies(ann).at(-1).result, rb = lobbies(ben).at(-1).result;
    assert.equal(ra.reason, 'bunkers'); assert.deepEqual(ra.at, g.endAt); assert.equal(ra.story.length, 3); assert.ok(ra.timeline.length >= 2);
    assert.ok(ra.story[1].losses + ra.story[2].losses >= 2, 'the bunkers are in the story');
    assert.deepEqual(ra.you, { outcome: 'victory', team: 0 }); assert.deepEqual(rb.you, { outcome: 'defeat', team: 1 });
    assert.deepEqual(room.players[2].lastMatch, { outcome: 'defeat', team: 1 }, 'the AI lost too');
    // a seat freed after the match takes its row of the story with it
    await ben.close(); h.clock.advance(10_000);
    await h.waitFor(() => lobbies(ann).at(-1).players.length === 2, 'the offline seat is freed');
    const after = lobbies(ann).at(-1).result;
    assert.deepEqual([after.names[0], after.names[1], after.names[2]], ['Ann', room.players[1].name, 'Ben'], 'the freed seat moves to the end');
    assert.deepEqual(after.story[2], ra.story[1], 'its story row moves with it');
    assert.deepEqual(after.story[1], ra.story[2], 'and the AI keeps its own row');
    await h.clear('endwin');
  }
  // a draw: Cal against an AI, every bunker down on the same tick
  {
    const { room, g, people: [cal] } = await setUp('enddraw', ['Cal']);
    for (const u of g.units.values()) if (u.type === 'bunker') u.hp = 0;
    await decided(room);
    assert.equal(g.winner, -1);
    await backInLobby(room, cal);
    const res = lobbies(cal).at(-1).result;
    assert.equal(res.winner, -1); assert.equal(res.reason, 'draw');
    assert.deepEqual(res.you, { outcome: 'draw', team: 0 }); assert.deepEqual(room.players[1].lastMatch, { outcome: 'draw', team: 1 });
    // the next start clears the result
    const after = cal.messages.length;
    await cal.send({ t: 'start' }); await cal.wait('start', () => true, after); await h.waitFor(() => lobbies(cal).at(-1).result === null, 'the lobby after the start'); // it can arrive after 'start'
    assert.ok(room.state === 'play' && room.game && lobbies(cal).at(-1).result === null, 'a new match without the old result');
    await h.clear('enddraw');
  }
  await h.close();
  console.log('match end: hold, fog lift, result and story checked over the server');
}
// Hotkey chords remain unique in every combination of simultaneously active contexts.
{
  const { bindings, match, rank, label, badge, FORT_KEYS, BUILD_KEYS, SUPPORT_KEYS, CARD_KEYS } = await import('./client/keys.js');
  // Recruit mode only exists outside Classic and the building letters only in Classic, so they never meet.
  for (const contexts of [['global', 'army'], ['global', 'classic'], ['global', 'targeting'],
    ['global', 'army', 'targeting'], ['global', 'classic', 'targeting'],
    ['global', 'army', 'recruit'], ['global', 'army', 'recruit', 'targeting'],
    ['global', 'classic', 'building'], ['global', 'classic', 'building', 'targeting']]) {
    const seen = new Map();
    for (const binding of bindings.filter(b => contexts.includes(b.context))) {
      const chord = [binding.code, binding.shift, binding.ctrl, binding.alt].join(':');
      const previous = seen.get(chord) ?? [];
      // a chord may be shared only across layers (base table, card letters, targeting), never inside one
      for (const other of previous) {
        assert.notEqual(rank(other.context), rank(binding.context), `${contexts.join('+')}: ${binding.id} collides with ${other.id}`);
      }
      seen.set(chord, [...previous, binding]);
    }
    for (const bindingsForChord of seen.values()) {
      const first = bindingsForChord[0];
      const expected = bindingsForChord.reduce((a, b) => (rank(b.context) > rank(a.context) ? b : a));
      assert.equal(match({ code: first.code, shiftKey: first.shift, ctrlKey: first.ctrl, altKey: first.alt }, contexts),
        expected.id, `${contexts.join('+')}: the top layer wins ${first.code}`);
    }
  }
  // The card letters: Q W E R T, A S D F G, Z X C V B in reading order, Shift for five, Tab or backquote to toggle.
  assert.equal(CARD_KEYS.join(''), 'QWERTASDFGZXCVB');
  for (const context of ['recruit', 'building']) {
    CARD_KEYS.forEach((key, i) => {
      assert.equal(match({ code: `Key${key}` }, ['army', context]), `card:${i + 1}`, `${context}: ${key} buys card ${i + 1}`);
      assert.equal(match({ code: `Key${key}`, shiftKey: true }, ['classic', context]), `cardMany:${i + 1}`);
    });
  }
  assert.equal(match({ code: 'KeyW' }, 'army'), 'panForward', 'WASD pans again once recruit mode is off');
  assert.equal(match({ code: 'KeyW' }, ['army', 'recruit']), 'card:2', 'recruit mode suspends WASD panning');
  assert.equal(match({ code: 'ArrowUp' }, ['army', 'recruit']), 'panForward', 'arrow keys still pan in recruit mode');
  assert.equal(match({ code: 'KeyR' }, ['army', 'recruit']), 'card:4', 'recruit mode suspends the army letters');
  assert.equal(match({ code: 'KeyJ' }, ['classic', 'building']), 'build:depot', 'Engineer build keys sit outside the card letters');
  for (const code of ['Tab', 'Backquote']) {
    assert.equal(match({ code }, 'army'), 'recruitMode');
    assert.equal(match({ code }, ['army', 'recruit']), 'recruitMode', `${code} also turns recruit mode off`);
  }
  assert.equal(match({ code: 'Escape' }, ['army', 'recruit']), 'recruitOff', 'Esc leaves recruit mode before clearing the selection');
  assert.equal(match({ code: 'Escape' }, ['army', 'recruit', 'targeting']), 'cancelAim', 'Esc cancels an aim first');
  assert.equal(match({ code: 'Tab' }, 'classic'), 'recruitMode', 'Classic answers Tab with a hint instead of moving focus');
  assert.equal(match({ code: 'Space' }, 'army'), 'alert');
  assert.equal(match({ code: 'Space', shiftKey: true }, 'army'), 'follow', 'Shift+Space never triggers the plain Space action');
  assert.equal(match({ code: 'KeyH', shiftKey: true }, 'army'), 'rally');
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(match({ code: 'KeyR', [modifier]: true }, 'classic'), undefined, `plain R rejects ${modifier}`);
  }
  assert.equal(match({ code: 'KeyA', metaKey: true }, 'army'), 'army', 'Meta selects the army like Ctrl');
  for (const [event, action] of [
    [{ code: 'Digit1' }, 'group:recall:1'],
    [{ code: 'Digit1', ctrlKey: true }, 'group:set:1'],
    [{ code: 'Digit1', metaKey: true }, 'group:set:1'],
    [{ code: 'Digit1', shiftKey: true }, 'group:append:1'],
    [{ code: 'Digit1', shiftKey: true, ctrlKey: true }, 'group:append:1'],
    [{ code: 'Digit1', shiftKey: true, metaKey: true }, 'group:append:1'],
  ]) assert.equal(match(event, 'army'), action);
  for (const [kind, key] of Object.entries({ trench: 'T', sandbags: 'Y', wire: 'U', traps: 'I', nest: 'O' })) {
    for (const context of ['army', 'classic']) assert.equal(match({ code: `Key${key}`, shiftKey: kind !== 'trench' }, context), `fort:${kind}`);
    assert.equal(FORT_KEYS[kind], label(`fort:${kind}`));
  }
  assert.equal(badge('fort:sandbags'), '\u21e7Y');
  assert.equal(badge('fort:trench'), 'T');
  for (const [kind, key] of Object.entries(SUPPORT_KEYS)) assert.equal(match({ code: `Key${key}` }, 'classic'), `support:${kind}`);
  for (const [kind, key] of Object.entries(BUILD_KEYS)) {
    assert.equal(match({ code: `Key${key}` }, 'classic'), `build:${kind}`);
    assert.equal(match({ code: `Key${key}` }, 'army'), undefined, 'Classic building chords stay mode-specific');
  }
  assert.equal(match({ code: 'Escape' }, 'army'), 'clear');
  assert.equal(match({ code: 'Escape' }, 'classic'), 'clear');
  assert.equal(match({ code: 'Escape' }, 'targeting'), 'cancelAim');
}

// Selection rules operate on own snapshot rows, including plans and dead group members.
{
  const { createSelection } = await import('./client/selection.js');
  const row = (id, type = 'rifle', extra = {}) => ({ id, type, owner: 0, hp: 20, x: 150, z: 10, flags: 0, ...extra });
  const units = new Map([
    row(12, 'rifle', { x: 80, plan: { kind: 0 } }),
    row(11, 'rifle', { flags: 128 }), row(10, 'rifle', { flags: 16 }), row(9, 'rifle', { flags: 1 }),
    row(8, 'rifle', { plan: { kind: 1 } }), row(7, 'rifle', { flags: 32 }), row(6, 'rifle', { owner: 1, x: 10 }),
    row(5, 'fighter', { x: 30, flags: 512 }), row(4, 'hq', { x: 30 }), row(3, 'engineer', { x: 20 }),
    row(2), row(1, 'rifle', { x: 10 }),
  ].map(v => [v.id, v]));
  const selected = new Set(), groups = {}, centers = [];
  const selection = createSelection({ units, selected, groups, owner: () => 0, definitions: UNITS,
    screenOf: v => ({ x: v.x, y: v.z, front: true }), viewport: () => ({ width: 100, height: 100 }),
    center: list => centers.push(list.map(v => v.id)) });
  const ids = () => [...selected].sort((a, b) => a - b);
  selection.click(units.get(1)); selection.click(units.get(3), { shiftKey: true });
  assert.deepEqual(ids(), [1, 3], 'Shift+click adds an unselected unit');
  selection.click(units.get(1), { shiftKey: true }); assert.deepEqual(ids(), [3], 'Shift+click removes a selected unit');
  selection.box({ x0: 0, x1: 15, y0: 0, y1: 30 }, { shiftKey: true }); assert.deepEqual(ids(), [1, 3], 'Shift+box adds');
  selection.box({ x0: 0, x1: 35, y0: 0, y1: 30 }); assert.deepEqual(ids(), [1, 3], 'box excludes enemy, building and grounded plane');
  selection.doubleClick(units.get(1)); assert.deepEqual(ids(), [1, 12], 'double-click selects the type on screen');
  selection.doubleClick(units.get(1), { ctrlKey: true }); assert.deepEqual(ids(), [1, 2, 7, 8, 9, 10, 11, 12], 'Ctrl+double-click selects the type map-wide');
  selection.army(); assert.deepEqual(ids(), [1, 2, 3, 7, 8, 9, 10, 11, 12], 'army selection excludes buildings, enemies and grounded planes');
  selection.type('rifle', { shiftKey: true }); assert.deepEqual(ids(), [3], 'Shift row click removes that type');
  selection.type('engineer'); assert.deepEqual(ids(), [3], 'plain row click keeps only that type');
  selection.army(); selection.type('engineer', { ctrlKey: true }); assert.deepEqual(ids(), [3], 'Ctrl row click keeps only that type');
  assert.deepEqual(selection.idle().map(v => v.id), [1, 2, 3, 12], 'idle units are sorted and exclude busy flags, plans, planes and buildings');
  selection.findIdle(); assert.deepEqual(ids(), [1]); selection.findIdle(); assert.deepEqual(ids(), [2]);
  selection.findIdle(false, true); assert.deepEqual(ids(), [3], 'Engineers have their own idle cursor');
  selection.findIdle(); assert.deepEqual(ids(), [3], 'army cursor continues independently');
  assert.deepEqual(centers.at(-1), [3], 'idle cycling centers the selected unit');
  selection.findIdle(true); assert.deepEqual(ids(), [1, 2, 3, 12], 'all idle units can be selected together');
  selection.click(units.get(3)); selection.group(1, 'set'); selection.click(units.get(1));
  groups[2] = [6, 999]; selection.group(1, 'append'); selection.group(1, 'append');
  assert.deepEqual(groups[1], [3, 1], 'append preserves the old selection without duplicates');
  assert.deepEqual(groups[2], [], 'group edits prune enemy and missing IDs');
  selection.group(1, 'recall', 100); const count = centers.length;
  selection.group(1, 'recall', 400); assert.equal(centers.length, count + 1, 'a second tap within 300 ms centers the group');
  selection.group(1, 'recall', 701); assert.equal(centers.length, count + 1, 'a later tap does not center');
  units.delete(3); selection.group(1, 'recall', 1002);
  assert.deepEqual(groups[1], [1]); assert.deepEqual(ids(), [1], 'recall drops dead members');
  selection.reset(); assert.deepEqual(groups, {}, 'new matches clear groups');
  selection.findIdle(); assert.deepEqual(ids(), [1], 'new matches reset idle cursors');
  const beforeRecall = centers.length; selection.group(1, 'set'); selection.group(1, 'recall', 1100);
  assert.equal(centers.length, beforeRecall, 'new matches and group edits reset the double-tap timer');
}
// Visible soldiers and roof bars remain selectable when the logical squad center is outside the box.
{
  const { createSelection, selectionDragged } = await import('./client/selection.js');
  const units = new Map([
    { id: 1, type: 'rifle', owner: 0, hp: 100, flags: 0, points: [{ x: 200, y: 200, front: true }, { x: 25, y: 25, front: true, boxRadius: 12 }] },
    { id: 2, type: 'mg', owner: 0, hp: 60, flags: 32, points: [{ x: 55, y: 25, front: true }] },
    { id: 3, type: 'hq', owner: 0, hp: 100, points: [{ x: 25, y: 25, front: true }] },
    { id: 4, type: 'rifle', owner: 1, hp: 100, points: [{ x: 25, y: 25, front: true }] },
    { id: 5, type: 'rifle', owner: 0, hp: 100, flags: 262144, points: [{ x: 25, y: 25, front: true }] },
    { id: 6, type: 'rifle', owner: 0, hp: 0, points: [{ x: 25, y: 25, front: true }] },
    { id: 7, type: 'rifle', owner: 0, hp: 100, flags: 0, points: [{ x: 200, y: 200, front: true }, { x: 70, y: 60, front: true }] },
    { id: 8, type: 'rifle', owner: 0, hp: 100, flags: 0, points: [{ x: 20, y: 20, front: false }] },
    { id: 9, type: 'fighter', owner: 0, hp: 100, flags: 512, points: [{ x: 25, y: 25, front: true }] },
  ].map(v => [v.id, v]));
  const selected = new Set();
  const selection = createSelection({ units, selected, groups: {}, owner: () => 0, definitions: UNITS,
    screenOf: v => v.points[0], screenPointsOf: v => v.points, viewport: () => ({ width: 100, height: 100 }), center() {} });
  assert.equal(selection.pick(25, 25).id, 1, 'visible soldier wins over a building, enemy, dead squad and passengers');
  assert.equal(selection.pick(55, 25).id, 2, 'roof bar selects a garrison');
  selection.box({ x0: 20, x1: 60, y0: 20, y1: 30 });
  assert.deepEqual([...selected], [1, 2], 'one box selects mixed troops at visible soldiers and roof bars without a prior selection');
  selection.box({ x0: 30, x1: 35, y0: 30, y1: 35 });
  assert.deepEqual([...selected], [1], 'a box intersecting the soldier target selects the squad without including nearby troops');
  selection.box({ x0: 38, x1: 40, y0: 24, y1: 26 });
  assert.deepEqual([...selected], [], 'box targets stay tighter than click forgiveness');
  selection.click(units.get(7));
  selection.box({ x0: 20, x1: 60, y0: 20, y1: 30 }, { shiftKey: true });
  assert.deepEqual([...selected], [7, 1, 2], 'Shift preserves another type when adding visible targets');
  selection.doubleClick(units.get(1));
  assert.deepEqual([...selected], [1, 7], 'double-click includes squads whose visible soldiers are on screen');
  selection.doubleClick(units.get(1), { ctrlKey: true });
  assert.deepEqual([...selected], [1, 7, 8], 'map-wide type selection excludes dead squads and passengers');
  selection.click(units.get(5)); assert.equal(selected.size, 0, 'a passenger cannot be selected by a stale direct click');
  assert.equal(selection.pick(600, 600), null, 'scenery and empty space do not select a unit');
  assert.equal(selectionDragged({ x: 10, y: 10 }, { clientX: 50, clientY: 50 }), true, 'release distance identifies a drag even without a move event');
  assert.equal(selectionDragged({ x: 10, y: 10 }, { clientX: 13, clientY: 14 }), false, 'small mouse jitter remains a click');
}
// Rendered bounds cover posed sniper boots and the ends of rooftop bars, without selecting gaps or rings.
{
  const THREE = await import('three');
  const { selectionPoints } = await import('./client/selection-view.js');
  const { createSelection } = await import('./client/selection.js');
  const { buildModel, animate } = await import('./client/unit-models.js');
  const { rigOf } = await import('./client/models/infantry.js');
  const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 1, 2200);
  camera.position.set(0, 25 * Math.sin(0.95), 25 * Math.cos(0.95)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const root = new THREE.Group(), bars = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  bar.scale.set(2.4, 0.42, 1); bars.position.y = 7.5; bars.quaternion.copy(camera.quaternion); bars.add(bar);
  const v = { id: 1, owner: 0, type: 'sniper', hp: 100, flags: 0, root, models: [], bars, x: 0, z: 0, supp: 95, cover: 0 };
  buildModel(v, root, { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 }, 0, UNITS.sniper);
  animate(v, 1, camera.position);
  const center = () => ({ x: 960, y: 506.168, front: true });
  const projected = () => selectionPoints(v, camera, center, 1920, 1080);
  const units = new Map([[1, v]]), selected = new Set(), groups = { 1: [1] };
  const selection = createSelection({ units, selected, groups, owner: () => 0, definitions: UNITS,
    screenOf: center, screenPointsOf: projected, viewport: () => ({ width: 1920, height: 1080 }), center() {} });
  const screen = p => { p.project(camera); return { x: (p.x + 1) * 960, y: (1 - p.y) * 540 }; };
  const leader = v.models[0], slot = leader.userData.slot;
  const foot = screen(rigOf('sniper', 0, 0, 2).legs[0].ankle.clone().multiplyScalar(leader.scale.x).add(new THREE.Vector3(slot[0], 0, slot[1])));
  selection.box({ x0: foot.x - 4, x1: foot.x + 4, y0: foot.y - 4, y1: foot.y + 4 });
  assert.deepEqual([...selected], [1], 'a narrow box around the actual prone sniper boot selects the squad');
  assert.equal(selection.pick(foot.x, foot.y), v, 'the actual prone boot is clickable');
  const before = projected().map(p => p.bounds);
  v.sel = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial()); root.add(v.sel);
  assert.deepEqual(projected().map(p => p.bounds), before, 'owner and selection rings never enlarge selectable bounds');
  const right = Math.max(...projected().filter(p => p.bounds).map(p => p.bounds.x1));
  assert.equal(selection.pick(right + 100, foot.y), null, 'empty ground outside the displayed geometry misses');
  v.garr = true;
  const roof = projected();
  assert.equal(roof.length, 1, 'garrison target contains only the displayed roof bar');
  const barEnd = screen(new THREE.Vector3(0.49, 0, 0).applyMatrix4(bar.matrixWorld));
  selection.box({ x0: barEnd.x - 2, x1: barEnd.x + 2, y0: barEnd.y - 2, y1: barEnd.y + 2 });
  assert.deepEqual([...selected], [1], 'a narrow box at the end of a roof bar selects its squad');
  assert.equal(selection.pick(barEnd.x, barEnd.y), v, 'the roof bar end is clickable');
  bars.visible = false; assert.deepEqual(projected(), [], 'hidden roof bars are not selectable');
  bars.visible = true;
  const passenger = { ...v, id: 2, type: 'rifle', flags: 262144 }, plane = { ...v, id: 3, type: 'fighter', flags: 512 };
  units.set(2, passenger); units.set(3, plane); groups[2] = [1, 2, 3];
  selection.group(2); assert.deepEqual([...selected], [1], 'recall skips passengers and parked planes');
  assert.deepEqual(groups[2], [1, 2, 3], 'recall retains IDs so units return after unloading or launching');
  passenger.flags = plane.flags = 0;
  selection.group(2); assert.deepEqual([...selected], [1, 2, 3], 'unloaded squads and launched planes return on recall');
  const nearCamera = new THREE.PerspectiveCamera(42, 1, 1, 100); nearCamera.updateMatrixWorld();
  const behind = new THREE.Group(); behind.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())); behind.position.z = 4;
  const hidden = { root: behind, models: [behind], bars: new THREE.Group(), garr: false };
  assert.equal(selectionPoints(hidden, nearCamera, () => ({ x: 0, y: 0, front: false }), 800, 800).filter(p => p.bounds).length, 0,
    'geometry behind the camera produces no mirrored selection bounds');
  behind.position.z = -1;
  const clipped = selectionPoints(hidden, nearCamera, () => ({ x: 0, y: 0, front: false }), 800, 800).filter(p => p.bounds);
  assert.ok(clipped.length && clipped.every(p => Object.values(p.bounds).every(Number.isFinite)), 'near-plane intersections produce finite clipped bounds');
}
// Camera: a mouse press during the opening glide ends it and still reaches the board, so the first click or box drag
// of a match selects (it used to be swallowed). A right-click is still dropped: its order was aimed at a moving view.
{
  const THREE = await import('three');
  const source = readFileSync(new URL('./client/camera.js', import.meta.url), 'utf8')
    .replace("from 'three'", `from '${import.meta.resolve('three')}'`)
    .replace("from '/shared/sim.js'", `from '${new URL('./shared/sim.js', import.meta.url)}'`);
  const { rig } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const saved = { innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight, addEventListener: globalThis.addEventListener };
  Object.assign(globalThis, { innerWidth: 1920, innerHeight: 1080, addEventListener: () => {} });
  try {
    const button = () => ({ setAttribute() {}, textContent: '' });
    rig.init({ cam: { x: 40, z: 40, yaw: 0, dist: 60 }, camera: new THREE.PerspectiveCamera(45, 1920 / 1080, 0.5, 2000), pitch: 0.95,
      keys: new Set(), dragging: () => null, world: () => null, units: new Map(), hAt: () => 0, bounds: () => ({ w: 160, h: 160 }),
      groundAt: () => null, tryStore: () => null, edgeButton: button(), panButton: button() });
    const press = (b) => {
      const e = { button: b, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
      rig.introPress(e); return e;
    };
    rig.startIntro(false); assert.ok(rig.intro, 'a new match opens with the glide');
    const left = press(0);
    assert.ok(!rig.intro, 'a press ends the glide');
    assert.ok(!left.stopped && !left.prevented, 'the press that ends the glide still reaches the board (selects)');
    assert.ok(!press(0).stopped, 'later presses pass untouched');
    rig.startIntro(false); assert.ok(press(2).stopped, 'a right-click during the glide gives no order');
    rig.startIntro(false); assert.ok(!press(1).stopped, 'a middle press during the glide still starts a rotation');
  } finally { Object.assign(globalThis, saved); }
}
// Map pings: the relay rules directly, then over the shared server harness.
{
  const { mapPing } = await import('./server/map-pings.js');
  const sent = [], player = { team: 0, ws: { readyState: 1 } };
  const ally = { team: 0, ws: { readyState: 1 } }, enemy = { team: 1, ws: { readyState: 1 } };
  const room = { state: 'play', game: { w: 10, h: 10, players: [{ out: true }, {}, {}] },
    players: [player, ally, enemy, { team: 0, ai: true, ws: { readyState: 1 } }, { team: 0, ws: { readyState: 3 } }] };
  const relay = (ws, msg) => sent.push({ ws, msg });
  mapPing(room, player, 0, { x: -1, z: 1 }, (_, msg) => sent.push(msg));
  assert.equal(player.mapPingTimes, undefined, 'invalid pings do not use the budget');
  player.mapPingTimes = [Date.now() - 5001, Date.now() - 5001, Date.now() - 5001];
  mapPing(room, player, 0, { x: 12.34, z: 20 }, relay);
  assert.deepEqual(sent.map(({ msg }) => msg), Array(2).fill({ t: 'ping', from: 0, x: 12.3, z: 20 }),
    'eliminated players can ping and expired limits clear');
  assert.deepEqual(sent.map(({ ws }) => ws), [player.ws, ally.ws], 'only open human teammate sockets receive pings');
  assert.equal(player.mapPingTimes.length, 1, 'the timestamp list stays small');
  sent.length = 0;
  for (const coordinates of [{ x: -5, z: 5 }, { x: 1e9, z: 5 }, { x: 'abc', z: 5 }, { x: 5, z: null },
    { x: 5 }, { x: NaN, z: 5 }, { x: 5, z: 21 }, { z: 5 }]) mapPing(room, player, 0, coordinates, relay);
  assert.equal(sent.length, 0, 'invalid map pings are not relayed');
  assert.equal(player.mapPingTimes.length, 1, 'invalid map pings preserve the remaining budget');
  for (let i = 0; i < 4; i++) mapPing(room, ally, 1, { x: i, z: 0 }, relay);
  assert.deepEqual(sent.filter(({ ws }) => ws === player.ws).map(({ msg }) => msg.x), [0, 1, 2], 'three pings per five seconds');
  assert.equal(sent.filter(({ ws }) => ws === enemy.ws).length, 0, 'the other team receives no map pings');
  sent.length = 0; player.ai = true;
  mapPing(room, player, 0, { x: 5, z: 5 }, relay);
  assert.equal(sent.length, 0, 'only human players can send map pings');
  delete player.ai; room.state = 'lobby';
  mapPing(room, player, 0, { x: 5, z: 5 }, relay);
  assert.equal(sent.length, 0, 'map pings require a running match');

  // the same rules over the shared server harness: real sockets, the real message handler
  const h = await serverHarness(), code = 'pings', clients = [];
  for (let slot = 0; slot < 3; slot++) clients.push(await h.connect(code, { token: `${code}${slot}`, name: `Player ${slot}` }));
  await clients[0].send({ t: 'team', slot: 1, v: 0 });
  await clients[0].send({ t: 'team', slot: 2, v: 1 });
  assert.equal(h.rooms.get(code).players.map(p => p.team).join(','), '0,0,1', 'teams');
  await clients[0].send({ t: 'start' });
  for (const client of clients) await client.wait('start');
  const map = clients[0].messages.find(msg => msg.t === 'start').map;
  const pings = client => client.messages.filter(msg => msg.t === 'ping');
  const clear = () => clients.forEach(client => { client.messages.length = 0; });
  clear();
  await clients[0].send({ t: 'ping', x: 12.3, z: 45.6 });
  await h.waitFor(() => pings(clients[0]).length === 1 && pings(clients[1]).length === 1, 'team ping');
  await h.settleServer();
  assert.deepEqual(pings(clients[1]), [{ t: 'ping', from: 0, x: 12.3, z: 45.6 }], 'the teammate receives the ping');
  assert.deepEqual(pings(clients[0]), pings(clients[1]), 'the sender receives the same relay');
  assert.equal(pings(clients[2]).length, 0, 'the other team receives no ping');
  clear();
  for (const coordinates of [
    { x: -5, z: 5 }, { x: 1e9, z: 5 }, { x: 'abc', z: 5 }, { x: 5, z: null },
    { x: 5 }, { x: NaN, z: 5 }, { x: 5, z: map.h * CELL + 1 }, { z: 5 },
  ]) await clients[0].send({ t: 'ping', ...coordinates });
  assert.ok(clients.every(client => pings(client).length === 0), 'invalid coordinates are silently dropped');
  clear();
  for (let i = 0; i < 4; i++) await clients[1].send({ t: 'ping', x: 20 + i, z: 30 });
  await h.waitFor(() => pings(clients[0]).length >= 3, 'three accepted pings');
  await h.settleServer();
  assert.deepEqual(pings(clients[0]).map(msg => msg.x), [20, 21, 22], 'the fourth ping inside five seconds is dropped');
  assert.deepEqual(pings(clients[1]), pings(clients[0]), 'the sender sees only accepted pings');
  assert.equal(pings(clients[2]).length, 0, 'rate-limited pings stay within the team');
  clear();
  await clients[0].send({ t: 'ping', c: 123, rtt: 5 });
  await clients[0].wait('pong', msg => msg.c === 123);
  assert.ok(clients.every(client => pings(client).length === 0), 'latency pings are never relayed');
  await h.close();
}
// Room lifecycle checks use one fake clock for captured timers and the socket retry module.
{

  const { createConnection } = await import('./client/connection.js');
  const { roomAddress, roomToken, matchStorage } = await import('./client/room-session.js');
  class FakeWebSocket {
    static sockets = [];
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWebSocket.sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.({}); }
    send(data) { this.sent.push(JSON.parse(data)); }
    message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  }
  {
    const clock = fakeClock(), retry = [], connected = [], dispatched = [];
    FakeWebSocket.sockets = [];
    const connection = createConnection({ url: () => 'ws://test/ws', hello: () => ({ t: 'hello', token: 'seat' }), WebSocket: FakeWebSocket, clock });
    connection.on('retry', data => retry.push(data));
    connection.on('connected', data => connected.push(data));
    connection.on('lobby', data => dispatched.push(data));
    connection.start();
    assert.equal(connection.send({ t: 'pause' }), false, 'closed sockets reject sends');
    let socket = FakeWebSocket.sockets.at(-1);
    socket.open();
    assert.deepEqual(socket.sent, [{ t: 'hello', token: 'seat' }], 'every connection sends the seat hello');
    for (const seconds of [1, 2, 4, 8, 8]) {
      socket.close();
      assert.deepEqual(retry.at(-1), { left: seconds, reason: 'lost' }, 'reconnect backoff is bounded');
      const count = FakeWebSocket.sockets.length;
      clock.advance(seconds * 1000 - 1);
      assert.equal(FakeWebSocket.sockets.length, count, 'a retry waits its full delay');
      if (seconds > 1) assert.equal(retry.at(-1).left, 1, 'the retry banner counts down each second');
      clock.advance(1);
      assert.equal(FakeWebSocket.sockets.length, count + 1, 'the retry opens a socket on time');
      socket = FakeWebSocket.sockets.at(-1); socket.open();
    }
    socket.message({ t: 'lobby', you: 0 }); socket.message({ t: 'lobby', you: 0 });
    assert.equal(connected.length, 1, 'a server answer marks the connection recovered once');
    assert.equal(dispatched.length, 2, 'registered handlers receive messages');
    socket.close();
    assert.equal(retry.at(-1).left, 1, 'a server answer resets the retry delay');
    clock.advance(1000);
    const newer = FakeWebSocket.sockets.at(-1); newer.open();
    socket.message({ t: 'replaced' }); socket.close();
    assert.equal(connection.isOpen(), true, 'late events from an old socket cannot stop the new one');
    newer.message({ t: 'lobby', you: 0 });
    connection.stop();
    const count = FakeWebSocket.sockets.length;
    clock.advance(60_000);
    assert.equal(FakeWebSocket.sockets.length, count, 'stop cancels pending retries');
  }
  {
    const clock = fakeClock(), retry = [], full = [], replaced = [];
    FakeWebSocket.sockets = [];
    const connection = createConnection({ url: 'ws://test/ws', hello: { t: 'hello', token: 'invite' }, WebSocket: FakeWebSocket, clock });
    connection.on('retry', data => retry.push(data)); connection.on('full', data => full.push(data)); connection.on('replaced', data => replaced.push(data));
    connection.start();
    const first = FakeWebSocket.sockets.at(-1); first.open(); first.message({ t: 'full', reason: 'started' });
    assert.equal(full.at(-1).reason, 'started', 'full preserves the server reason');
    assert.deepEqual(retry.at(-1), { left: 10, reason: 'full' }, 'an invite retries every ten seconds');
    first.close(); clock.advance(9999);
    assert.equal(FakeWebSocket.sockets.length, 1, 'the close after full cannot shorten the retry');
    clock.advance(1);
    const second = FakeWebSocket.sockets.at(-1); second.close();
    assert.deepEqual(retry.at(-1), { left: 10, reason: 'full' }, 'transport failure keeps the invite retry interval');
    clock.advance(10_000);
    const third = FakeWebSocket.sockets.at(-1); third.open(); third.message({ t: 'lobby', you: 0 }); third.close();
    assert.equal(retry.at(-1).left, 1, 'joining the room restores normal reconnect timing');
    clock.advance(1000);
    const fourth = FakeWebSocket.sockets.at(-1); fourth.open(); fourth.message({ t: 'replaced' });
    assert.equal(replaced.length, 1, 'a replaced seat is reported');
    assert.equal(connection.isOpen(), false, 'a replaced seat releases the socket');
    const count = FakeWebSocket.sockets.length; clock.advance(60_000);
    assert.equal(FakeWebSocket.sockets.length, count, 'a replaced tab stops retrying');
    connection.start();
    const reclaimed = FakeWebSocket.sockets.at(-1); reclaimed.open(); reclaimed.message({ t: 'lobby', you: 0 });
    fourth.message({ t: 'replaced' }); fourth.close();
    assert.equal(connection.isOpen(), true, 'Use it here starts a connection protected from old events');
    connection.stop();
  }
  {
    const storage = () => {
      const data = new Map();
      return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
    };
    const local = storage(), session = storage(); let generated = 0;
    const token = (room, seat = '', mirror = session) => roomToken({ room, seat, local, session: mirror, create: () => 'token-' + ++generated });
    assert.deepEqual(roomAddress('#ABC&seat=2'), { room: 'abc', seat: '2', hash: '#abc&seat=2' }, 'room hashes retain the seat suffix');
    assert.deepEqual(roomAddress('#&seat=2'), { room: 'main', seat: '2', hash: '#&seat=2' }, 'the main room retains its seat suffix');
    const first = token('abc'), second = token('abc', '2'), other = token('xyz');
    assert.notEqual(first, second, 'two seats on one machine have separate tokens');
    assert.notEqual(first, other, 'tokens are scoped to the room');
    const reopened = storage();
    assert.equal(token('abc', '', reopened), first, 'a reopened tab keeps its seat from local storage');
    assert.equal(reopened.getItem('ww2-token:abc'), first, 'the token is mirrored into the new session');
    assert.equal(local.getItem('ww2-token:abc:2'), second, 'a seat suffix has its own persistent key');
    session.setItem('ww2-token:fallback', 'session-seat');
    assert.equal(token('fallback'), 'session-seat', 'a session mirror can recover a missing local token');
    assert.equal(local.getItem('ww2-token:fallback'), 'session-seat', 'recovered tokens restore the local mirror');
    const saved = { matchId: 3, camera: { x: 20, z: 30, yaw: 0.5, dist: 80 }, selected: [1, 4], groups: { 1: [1], 2: [4] } };
    const state = matchStorage(first, local, session); state.write(saved);
    assert.deepEqual(matchStorage(first, local, reopened).read(), saved, 'camera, selection and groups survive reopening the same seat');
    assert.equal(matchStorage(second, local, session).read(), null, 'one seat cannot inherit another seat camera');
    local.setItem('ww2-match:' + first, '{broken');
    assert.deepEqual(state.read(), saved, 'the session mirror recovers a damaged local match record');
    state.clear();
    assert.equal(state.read(), null, 'ending a match clears both saved mirrors');
    state.write({ ...saved, selected: 'invalid', groups: null });
    const clean = state.read();
    assert.deepEqual(clean.selected, [], 'malformed saved selection cannot reach the game');
    assert.deepEqual(clean.groups, {}, 'malformed saved groups cannot reach the game');
  }

  async function roomLifecycleChecks(h) {
    let caseId = 0;
    const last = (client, type) => client.messages.findLast(message => message.t === type);
    const check = async fn => { const code = 'r3t' + ++caseId; try { await fn(code); } finally { await h.clear(code); } };
    const humans = async (code, names = ['Ana', 'Ben']) => {
      const players = [];
      for (const name of names) players.push(await h.connect(code, { token: code + name, name }));
      return players;
    };
    const start = async (code, host) => {
      const after = host.messages.length; await host.send({ t: 'start' }); await host.wait('start', () => true, after); return h.rooms.get(code);
    };

    await check(async code => {
      const [ana] = await humans(code, ['Ana']);
      await ana.close();
      assert.equal(h.rooms.get(code).emptySince, 0, 'an empty room can start its grace period at fake time zero');
      h.clock.advance(60_000); await h.tick();
      assert.ok(h.rooms.has(code), 'an empty room survives the full one-minute grace period');
      h.clock.advance(1); await h.tick();
      assert.equal(h.rooms.has(code), false, 'an empty room expires after its grace period');
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      await ana.close();
      await ben.wait('lobby', message => message.host === 1 && !message.players[0].connected);
      assert.equal(last(ben, 'lobby').host, 1, 'the next connected human inherits host controls');
      const room = h.rooms.get(code); h.clock.advance(9999); await h.settleServer();
      assert.equal(room.players.length, 3, 'an offline seat is held for ten seconds');
      await cy.send({ t: 'kick', slot: 0 });
      assert.equal(room.players.length, 3, 'only the host can kick an offline human');
      await ben.send({ t: 'kick', slot: 0 });
      assert.equal(room.players.length, 2, 'the host can kick an offline human');
      await ben.wait('lobby', message => message.you === 0 && message.host === 0);
      await ben.send({ t: 'kick', slot: 1 });
      assert.equal(room.players.length, 2, 'a connected human cannot be kicked');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = h.rooms.get(code), player = room.players[1];
      await ben.close(); h.clock.advance(9999); await h.settleServer();
      assert.equal(room.players.length, 2, 'cleanup does not free a seat early');
      const refresh = await h.connect(code, { token: ben.token, name: 'Ben' });
      h.clock.advance(1); await h.settleServer();
      assert.equal(room.players[1], player, 'a refresh retains the player object and cancels cleanup');
      await refresh.close(); h.clock.advance(10_000); await h.settleServer();
      assert.equal(room.players.length, 1, 'an unrecovered lobby seat is freed after ten seconds');
      await ana.wait('lobby', message => message.players.length === 1);
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      const room = await start(code, ana), player = room.players[1];
      await ben.close();
      assert.equal(room.pause?.player, player, 'a human drop pauses their match');
      await cy.send({ t: 'handAi', slot: 1 });
      assert.equal(player.ai, undefined, 'a non-host cannot hand an army to AI');
      await ana.send({ t: 'handAi', slot: '1' });
      assert.equal(player.ai, undefined, 'hand to AI requires an integer seat');
      await ana.send({ t: 'handAi', slot: 1 });
      assert.equal(room.players[1], player, 'hand to AI keeps the army seat');
      assert.equal(player.ai, true); assert.equal(player.token, ''); assert.equal(player.ws, null);
      assert.equal(room.pause, null, 'hand to AI ends that player drop pause');
      await h.tick(); assert.equal(room.game.players[1].away, false, 'the AI army is active');
      await cy.send({ t: 'leave' }); await cy.wait('left');
      assert.equal(room.players[2].ai, true, 'leave uses the same AI handover');
    });
    await check(async code => {
      const [ana, ben, cy] = await humans(code, ['Ana', 'Ben', 'Cy']);
      const room = await start(code, ana), retained = [room.players[1], room.players[2]];
      const { finish } = await import('./shared/sim.js');
      await ana.close(); await ben.send({ t: 'resume' }); finish(room.game, 1, 'vp');
      for (let i = 0; i < 200 && room.state === 'play'; i++) await h.tick(); // the 6 s closing hold, then the lobby
      assert.equal(room.state, 'lobby', 'natural match end returns to the lobby');
      assert.deepEqual(room.players, retained, 'match end frees offline humans and retains player objects');
      assert.deepEqual(room.players.map(player => player.lastMatch), [{ outcome: 'victory', team: 1 }, { outcome: 'defeat', team: 2 }], 'per-player reports survive seat freeing');
      assert.equal(room.result.story.length, 3, 'the story keeps a row per seat');
      assert.deepEqual(room.result.teams, [1, 2, 0], 'result teams follow current seats before freed players');
      assert.deepEqual(room.result.names, ['Ben', 'Cy', 'Ana'], 'result names use the same order');
      const lobby = await ben.wait('lobby', message => message.state === 'lobby' && message.result?.winner === 1);
      assert.equal(lobby.result.teams[lobby.you], lobby.result.winner, 'the remaining winner still sees Victory after their seat shifts');
      const dana = await h.connect(code, { token: code + 'Dana', name: 'Dana' });
      assert.equal(room.players[2].team, 0, 'a new seat receives an unused team');
      assert.deepEqual(room.result.teams, [1, 2, null, 0], 'newcomers do not inherit the freed player result');
      assert.deepEqual(last(dana, 'lobby').result.names, ['Ben', 'Cy', '', 'Ana']);
      await cy.close(); h.clock.advance(10_000); await h.settleServer();
      assert.deepEqual(room.result.teams, [1, null, 2, 0], 'later lobby cleanup keeps the result aligned');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana), player = room.players[0], matchId = room.matchId;
      assert.ok(Number.isSafeInteger(matchId) && matchId > 0, 'start identifies the match');
      const replacement = await h.connect(code, { token: ana.token, name: 'Ana' });
      await ana.wait('replaced'); await h.settleServer();
      assert.equal(ana.closed, true, 'the replaced socket is closed after its message');
      assert.equal(room.players[0], player, 'replacement keeps the same player object');
      assert.equal(room.pause, null, 'replacement does not trigger a drop pause');
      assert.equal((await replacement.wait('start')).matchId, matchId, 'same-match reconnect keeps its match id');
      await replacement.send({ t: 'pause' });
      const joining = await h.connect(code, { token: ben.token, name: 'Ben' }); await joining.wait('start');
      const types = joining.messages.map(message => message.t);
      assert.ok(types.indexOf('start') < types.indexOf('pause'), 'a reconnect gets start before the pause state');
      assert.equal(last(joining, 'pause').reason, 'host', 'a reconnect sees the current host pause');
      const after = replacement.messages.length; await replacement.send({ t: 'restart' });
      const restarted = await replacement.wait('start', message => message.matchId === matchId + 1, after);
      assert.equal(restarted.matchId, matchId + 1, 'restart increments the match counter');
      assert.equal(room.pause, null, 'restart clears pause');
      assert.equal(last(replacement, 'pause').paused, false, 'restart broadcasts resume');
    });
    await check(async code => {
      const [ana, ben] = await humans(code); await ana.send({ t: 'addAi' });
      const room = await start(code, ana), g = room.game;
      await ben.send({ t: 'pause' }); assert.equal(room.pause, null, 'only the host can pause');
      await ana.send({ t: 'pause' });
      assert.deepEqual(last(ana, 'pause'), { t: 'pause', paused: true, by: 'Ana', reason: 'host', left: 0 });
      const before = { tick: g.tick, nextId: g.nextId, mp: g.players[0].mp, units: g.units.size };
      await ana.send({ t: 'buy', unit: 'rifle' }); await h.tick(40);
      assert.deepEqual({ tick: g.tick, nextId: g.nextId, mp: g.players[0].mp, units: g.units.size }, before, 'pause rejects commands and skips simulation and AI');
      const count = h.snapshots(ana).length;
      h.clock.advance(999); await h.tick(); assert.equal(h.snapshots(ana).length, count, 'paused snapshots wait one second');
      h.clock.advance(1); await h.tick(); assert.equal(h.snapshots(ana).length, count + 1, 'paused matches send a snapshot once a second');
      await h.tick(20); assert.equal(h.snapshots(ana).length, count + 1, 'paused snapshots do not repeat before time advances');
      await ben.send({ t: 'resume' }); assert.ok(room.pause, 'only the host can resume');
      await ana.send({ t: 'resume' }); assert.equal(room.pause, null);
      await h.tick(); assert.equal(g.tick, before.tick + 1, 'host resume restarts simulation');
      await ana.send({ t: 'pause' }); await ben.close(); await ana.send({ t: 'end' });
      assert.equal(room.pause, null, 'host end clears pause');
      assert.equal(room.state, 'lobby'); assert.equal(room.players.length, 2, 'host end frees the offline human and keeps the AI');
      assert.equal(last(ana, 'pause').paused, false, 'host end broadcasts resume');
    });
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana), g = room.game;
      await ben.close();
      assert.deepEqual(last(ana, 'pause'), { t: 'pause', paused: true, by: 'Ben', reason: 'drop', left: 30 });
      h.clock.advance(6000); await h.tick(); assert.equal(last(ana, 'pause').left, 24, 'drop pause shows whole seconds remaining');
      h.clock.advance(23_999); await h.tick(); assert.ok(room.pause, 'drop pause lasts until its deadline');
      assert.equal(g.tick, 0, 'simulation stays stopped while waiting');
      h.clock.advance(1); await h.tick(); assert.equal(room.pause, null, 'drop pause expires at thirty seconds');
      assert.equal(g.tick, 1, 'the first tick after the deadline advances the match');
      const returned = await h.connect(code, { token: ben.token, name: 'Ben' }); await returned.wait('start'); await returned.close();
      assert.equal(room.pause, null, 'the same player cannot auto-pause twice in one match');
      const returnedAgain = await h.connect(code, { token: ben.token, name: 'Ben' });
      const after = ana.messages.length; await ana.send({ t: 'restart' }); await ana.wait('start', () => true, after);
      await returnedAgain.close(); assert.equal(room.pause?.reason, 'drop', 'a new match resets the auto-pause allowance');
      const restored = await h.connect(code, { token: ben.token, name: 'Ben' }); await restored.wait('start');
      assert.equal(room.pause, null, 'reconnect ends a drop pause');
      assert.equal(last(ana, 'pause').paused, false, 'reconnect broadcasts resume');
      await ana.close(); assert.equal(room.pause?.by, 'Ana', 'each human has their own pause allowance');
      await restored.send({ t: 'resume' }); assert.equal(room.pause, null, 'the current host can end a drop pause');
    });
    await check(async code => {
      const [ana] = await humans(code, ['Ana']);
      const { MAX_PLAYERS } = await import('./shared/sim.js');
      for (let i = 1; i < MAX_PLAYERS; i++) await ana.send({ t: 'addAi' });
      const invite = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(invite, 'lobby').spectator, true, 'a full lobby seats nobody else: the invite watches');
      assert.equal(last(invite, 'lobby').you, -1, 'a spectator has no seat');
      for (let i = 1; i < 8; i++) await h.connect(code, { token: code + 'watch' + i, name: 'Watch' });
      const full = await h.connect(code, { token: code + 'late', name: 'Late' });
      assert.equal(last(full, 'full').reason, 'seats', 'a room with eight spectators turns the next one away');
    });
    // Spectators: a late invite watches the running match with the fog lifted, commands nothing and can sit down afterwards.
    await check(async code => {
      const [ana, ben] = await humans(code), room = await start(code, ana);
      const invite = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(invite, 'lobby').spectator, true, 'an invite cannot claim a new seat during play: it watches');
      const begin = await invite.wait('start');
      assert.equal(begin.you, 0, 'a spectator watches from the first seat');
      assert.equal(begin.fog, undefined, 'a spectator gets no fog mask');
      const after = invite.messages.length; await h.tick(2);
      const seen = await invite.wait('s', () => true, after);
      assert.equal(seen.units.length, room.game.units.size, 'a spectator sees every unit');
      assert.equal(seen.fog, undefined, 'a spectator gets no fog changes');
      assert.ok(last(ana, 's').units.length < seen.units.length, 'the seat it watches from still sees only its own side');
      const tick = room.game.tick;
      await invite.send({ t: 'leave' }); await invite.send({ t: 'end' }); await invite.send({ t: 'pause' }); await invite.send({ t: 'stop', ids: [...room.game.units.keys()] });
      assert.ok(room.state === 'play' && !room.pause && room.players.every(p => !p.ai), 'a spectator cannot leave for a player, end or pause the match');
      assert.ok(!last(invite, 'deny'), 'the orders of a spectator are dropped without an answer');
      await h.tick(); assert.equal(room.game.tick, tick + 1, 'the match runs on');
      await ben.close(); await ana.send({ t: 'end' });
      assert.equal(last(invite, 'lobby').state, 'lobby', 'the spectator is back in the lobby with everyone');
      await invite.send({ t: 'sit' });
      assert.equal(last(invite, 'lobby').spectator, false, 'a spectator can take a seat in the lobby');
      assert.equal(room.players.length, 2, 'the disconnected match seat was freed for the invite');
      await invite.send({ t: 'spectate' });
      assert.deepEqual([room.players.length, room.spectators.length, last(invite, 'lobby').you], [1, 1, -1], 'a seated player can step back to watch');
    });
    // An all-AI room: the host steps back to watch, still hosts, and the room lives while a spectator is connected.
    await check(async code => {
      const [ana] = await humans(code, ['Ana']), room = h.rooms.get(code);
      await ana.send({ t: 'spectate' }); await ana.send({ t: 'start' });
      assert.equal(room.state, 'lobby', 'a match needs at least one seat');
      await ana.send({ t: 'addAi' }); await ana.send({ t: 'addAi' });
      assert.deepEqual(room.players.map(p => !!p.ai), [true, true], 'a spectator hosts a room of AIs');
      assert.equal(last(ana, 'lobby').amHost, true, 'the spectator is told it hosts');
      await start(code, ana);
      const after = ana.messages.length; await h.tick(2);
      assert.equal((await ana.wait('s', () => true, after)).units.length, room.game.units.size, 'the spectator sees both AI armies');
      assert.equal(room.emptySince ?? null, null, 'a watched room is not empty');
      await ana.send({ t: 'end' }); assert.equal(room.state, 'lobby', 'the spectating host can end the match');
      await ana.close();
      assert.ok(room.emptySince != null && !room.spectators.length, 'a spectator who disconnects is gone, and the room starts its grace period');
    });
    console.log(`Room lifecycle: ${caseId} scenarios passed`);
  }

  const harness = await serverHarness();
  try { await roomLifecycleChecks(harness); }
  finally { await harness.close(); }
}
// Shift orders finish one task before starting the next, and ordinary orders replace the plan.
{
  const g = fresh(); g.players[0].mp = 5000;
  const u = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'move', queue: true, orders: [[u.id, 15, 5]] });
  step(g);
  assert.deepEqual(snapshotFor(g, 0, []).orders, [], 'an active order without waiting orders adds no snapshot row');
  command(g, 0, { t: 'move', queue: true, orders: [[u.id, 27, 5]] });
  command(g, 0, { t: 'amove', queue: true, orders: [[u.id, 27, 27]] });
  assert.equal(u.orders.length, 2, 'the first Shift order starts on the next tick, with two waiting');
  assert.equal(u.amove, null, 'queued attack-move does not interrupt movement');
  assert.deepEqual(snapshotFor(g, 0, []).orders.find(q => q[0] === u.id), [u.id, 2, 1, 27, 5, 2, 27, 27], 'snapshot preserves waiting order sequence');
  let passedFirst = false, passedSecond = false;
  for (let i = 0; i < 20 * 15; i++) {
    step(g);
    if (Math.hypot(u.x - 15, u.z - 5) < 1) passedFirst = true;
    if (u.amove) {
      assert.ok(passedFirst, 'first move finished before attack-move');
      assert.ok(Math.hypot(u.x - 27, u.z - 5) < 1 || passedSecond, 'second move finished before attack-move');
      passedSecond = true;
    }
  }
  assert.ok(passedFirst && passedSecond, 'both move destinations were visited in sequence');
  assert.ok(Math.hypot(u.x - 27, u.z - 27) < 3, 'attack-move reaches the final destination');
  assert.equal(u.orders.length, 0, 'finished orders leave the queue');
  assert.deepEqual(snapshotFor(g, 0, []).orders, [], 'finished queues have no snapshot rows');
  for (const replacement of ['move', 'stop', 'retreat']) {
    command(g, 0, { t: 'move', orders: [[u.id, 5, 5]] });
    command(g, 0, { t: 'amove', queue: true, orders: [[u.id, 5, 27]] });
    assert.equal(u.orders.length, 1, 'an order is waiting before replacement');
    command(g, 0, replacement === 'move' ? { t: 'move', orders: [[u.id, 35, 27]] } : { t: replacement, ids: [u.id], queue: true });
    assert.equal(u.orders.length, 0, `${replacement} clears waiting orders`);
  }
  command(g, 0, { t: 'move', orders: [[u.id, 5, 5]] });
  for (let i = 0; i < 12; i++) command(g, 0, { t: 'move', queue: true, orders: [[u.id, 7 + i * 2, 15]] });
  assert.equal(u.orders.length, 8, 'at most eight orders can wait');
  assert.equal(u.orders.at(-1).x, 21, 'overflow leaves accepted orders unchanged');
  assert.equal(command(g, 0, { t: 'move', queue: true, orders: [[u.id, 9, 9]] }), 'queueFull', 'a full order queue is refused with its reason');
  assert.equal(command(g, 0, { t: 'orders', queue: true, commands: [{ t: 'move', orders: [[u.id, 9, 9]] }] }), 'queueFull', 'grouped orders report the refusal too');
}

// Queued digging spends MP when it starts, and an unaffordable task is skipped.
{
  const g = fresh(); g.players[0].mp = 1000;
  const u = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'move', orders: [[u.id, 27, 5]] });
  const mp = g.players[0].mp;
  command(g, 0, { t: 'dig', ids: [u.id], queue: true, x: 27, z: 5, dir: 0 });
  command(g, 0, { t: 'move', queue: true, orders: [[u.id, 27, 27]] });
  assert.equal(g.players[0].mp, mp, 'waiting trench has not spent MP');
  assert.equal(u.dig, null, 'waiting trench does not begin early');
  let paid = false;
  for (let i = 0; i < 20 * 8 && !u.dig; i++) {
    const before = g.players[0].mp;
    step(g);
    if (u.dig) paid = before - g.players[0].mp > CFG.digCost - 1 && before - g.players[0].mp <= CFG.digCost;
  }
  assert.ok(u.dig && paid, 'trench is paid for on activation');
  const cells = u.dig.cells.map(([c]) => c);
  run(g, CFG.digCells * CFG.digTime + 8);
  assert.ok(cells.every(c => g.chars[c] === 'T'), 'queued trench is finished');
  assert.ok(Math.hypot(u.x - 27, u.z - 27) < 1, 'movement after the trench continues');

  const poor = fresh(); poor.players[0].mp = 1000;
  const r = put(poor, 0, 'rifle', 5, 5);
  command(poor, 0, { t: 'move', orders: [[r.id, 7, 5]] });
  command(poor, 0, { t: 'dig', ids: [r.id], queue: true, x: 7, z: 5, dir: 0 });
  command(poor, 0, { t: 'move', queue: true, orders: [[r.id, 17, 5]] });
  poor.players[0].mp = 0;
  run(poor, 4);
  assert.equal(r.dig, null, 'trench is dropped when its activation cannot be paid');
  assert.ok(!poor.chars.includes('T'), 'unpaid task creates no trench cells');
  assert.ok(Math.hypot(r.x - 17, r.z - 5) < 1, 'a skipped trench does not block the following move');
  assert.equal(r.orders.length, 0, 'skipped and finished orders leave the queue');
}

// Queued targets remember their issued position without exposing movement under fog.
{
  const rows = Array(60).fill('.'.repeat(60));
  const g = fresh(rows); g.players[0].mp = g.players[1].mp = 1000;
  const u = put(g, 0, 'rifle', 5, 5), enemy = put(g, 1, 'rifle', 15, 5);
  u.cooldown = enemy.cooldown = 100;
  run(g, 0.3);
  command(g, 0, { t: 'move', orders: [[u.id, 5, 27]] });
  command(g, 0, { t: 'attack', ids: [u.id], target: enemy.id, queue: true });
  command(g, 0, { t: 'move', orders: [[u.id, 27, 27]], queue: true });
  assert.deepEqual([u.orders[0].x, u.orders[0].z], [15, 5], 'attack saves the position visible when issued');
  enemy.x = 19;
  assert.deepEqual(snapshotFor(g, 0, []).orders.find(q => q[0] === u.id).slice(2, 5), [4, 19, 5], 'a currently visible queued target uses its current position');
  enemy.x = enemy.z = 111;
  run(g, 0.3);
  assert.ok(!g.players[0].visible.has(enemy.id), 'target has left team vision');
  assert.deepEqual(snapshotFor(g, 0, []).orders.find(q => q[0] === u.id).slice(2, 5), [4, 15, 5], 'hidden target stays at the recorded issued position');
  run(g, 12);
  assert.equal(u.attackId, 0, 'hidden target is skipped when its order starts');
  assert.ok(Math.hypot(u.x - 27, u.z - 27) < 1, 'following move proceeds after the hidden target');

  enemy.x = 35; enemy.z = 27; run(g, 0.3);
  command(g, 0, { t: 'move', orders: [[u.id, 27, 39]] });
  command(g, 0, { t: 'attack', ids: [u.id], target: enemy.id, queue: true });
  command(g, 0, { t: 'move', orders: [[u.id, 39, 39]], queue: true });
  assert.equal(u.orders.length, 2, 'visible target is queued before disappearing');
  g.units.delete(enemy.id);
  run(g, 8);
  assert.equal(u.attackId, 0, 'removed target is skipped when its order starts');
  assert.ok(Math.hypot(u.x - 39, u.z - 39) < 1, 'following move proceeds after the removed target');
}

// Shared team vision reveals units, but waiting orders and recruit rallies stay personal.
{
  const g = createGame(blank(Array(60).fill('.'.repeat(60))), ['a', 'b', 'c'], false, [0, 0, 1]);
  g.units.clear(); g.players.forEach(p => { p.mp = 5000; p.spawn = { x: -1000, z: -1000 }; });
  const own = put(g, 0, 'rifle', 5, 5), ally = put(g, 1, 'rifle', 11, 5), enemy = put(g, 2, 'rifle', 19, 5);
  for (const u of [own, ally, enemy]) {
    u.cooldown = 100;
    command(g, u.owner, { t: 'move', orders: [[u.id, u.x, 27]] });
    command(g, u.owner, { t: 'amove', queue: true, orders: [[u.id, u.x, 39]] });
  }
  command(g, 0, { t: 'rally', x: 51, z: 51 });
  command(g, 1, { t: 'rally', x: 61, z: 61 });
  command(g, 2, { t: 'rally', x: 71, z: 71 });
  run(g, 0.3);
  for (const slot of [0, 1, 2]) {
    const snap = snapshotFor(g, slot, []), id = [own, ally, enemy][slot].id;
    assert.deepEqual(snap.orders.map(q => q[0]), [id], 'snapshot contains only the receiving player\'s waiting orders');
    assert.deepEqual(snap.rally, [51 + slot * 10, 51 + slot * 10], 'snapshot contains only the receiving player\'s recruit rally');
  }
  assert.ok(snapshotFor(g, 0, []).units.some(q => q[0] === ally.id), 'ally is visible despite its private orders');
  ally.x = 63; ally.z = 65; enemy.x = enemy.z = 65;
  command(g, 1, { t: 'stop', ids: [ally.id] });
  command(g, 2, { t: 'stop', ids: [enemy.id] });
  run(g, 0.3);
  assert.ok(Math.hypot(own.x - enemy.x, own.z - enemy.z) > UNITS.rifle.vision, 'queued target is outside the ordering squad\'s vision');
  command(g, 0, { t: 'attack', ids: [own.id], target: enemy.id, queue: true });
  enemy.x = 67;
  assert.deepEqual(snapshotFor(g, 0, []).orders.find(q => q[0] === own.id).slice(5, 8), [4, 67, 65], 'allied spotting updates a queued target for the whole team');
}

// Conquest and Assault recruits walk to a valid personal rally, with strict destination validation.
{
  const rows = Array(60).fill('.'.repeat(60)); rows[25] = '.'.repeat(25) + 'W' + '.'.repeat(34);
  const map = { ...blank(rows), spawns: [{ x: 5, y: 5 }, { x: 50, y: 50 }] };
  for (const mode of ['conquest', 'assault']) {
    const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], mode === 'assault' ? { mode, defenderTeam: 1 } : {});
    const p = g.players[0]; p.mp = 5000;
    assert.equal(snapshotFor(g, 0, []).rally, null, `${mode} starts without a recruit rally`);
    command(g, 0, { t: 'rally', x: 41, z: 41 });
    assert.deepEqual(snapshotFor(g, 0, []).rally, [41, 41], `${mode} stores the personal recruit rally`);
    for (const [x, z] of [[-1, 41], [120, 41], [41, 120], [NaN, 41], [51, 51]]) {
      command(g, 0, { t: 'rally', x, z });
      assert.deepEqual(snapshotFor(g, 0, []).rally, [41, 41], `${mode} rejects an invalid or impassable rally`);
    }
    command(g, 0, { t: 'buy', unit: 'rifle' });
    const recruit = [...g.units.values()].at(-1);
    assert.ok(recruit.path.length, `${mode} recruit immediately receives a route`);
    assert.deepEqual(recruit.path.at(-1), { x: 41, z: 41 }, `${mode} recruit heads to the personal rally`);
  }
}

// Recruit rallies leave purchased planes at base and deliberate drops at their landing point.
{
  const map = blank(Array(60).fill('.'.repeat(60)));
  const g = createGame(map, ['a', 'b'], false); g.players[0].mp = 2000;
  command(g, 0, { t: 'rally', x: 80, z: 80 });
  for (const type of ['fighter', 'attacker']) command(g, 0, { t: 'buy', unit: type });
  const planes = [...g.units.values()].filter(u => u.owner === 0 && u.air);
  assert.deepEqual(planes.map(u => u.type), ['fighter', 'attacker'], 'both planes were recruited');
  run(g, 4);
  for (const plane of planes) {
    assert.equal(plane.air.state, 'base', `${plane.type} waits at base despite the rally`);
    assert.equal(plane.air.mission, null, `${plane.type} has no automatic mission`);
    assert.equal(plane.air.fuel, CFG.air.station, `${plane.type} does not burn fuel`);
  }

  const drop = fresh(Array(60).fill('.'.repeat(60))); drop.players[0].mp = 1000;
  drop.players[0].spawn = { x: 10, z: 10 };
  const scout = put(drop, 0, 'rifle', 10, 10);
  run(drop, 0.3);
  command(drop, 0, { t: 'rally', x: 80, z: 80 });
  command(drop, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
  assert.equal(drop.strikes.length, 1, 'visible paradrop was accepted');
  run(drop, SUPPORT.para.delay + 0.1);
  const trooper = [...drop.units.values()].find(u => u.owner === 0 && u.type === 'rifle' && u !== scout);
  assert.ok(trooper, 'paratroopers landed');
  assert.deepEqual(trooper.path, [], 'paratroopers have no rally route');
  assert.ok(Math.hypot(trooper.x - 20, trooper.z - 12) < SUPPORT.para.spread + 3, 'paratroopers landed around the chosen point');
  const at = { x: trooper.x, z: trooper.z };
  run(drop, 1);
  assert.deepEqual({ x: trooper.x, z: trooper.z }, at, 'paratroopers stay at the drop point');
}

// Classic keeps training separate from unit orders, and Engineers finish queued field and building work.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 5, y: 5 }, { x: 5, y: 70 }, { x: 70, y: 70 }], points: [{ x: 40, y: 40 }] };
  // the 1v1 uses the first two spawns only, so player 0 holds the top-left corner and the enemy the bottom-left
  const classic = (teams = [0, 1], m = teams.length > 2 ? map : { ...map, spawns: map.spawns.slice(0, 2) }) => createGame(m, teams.map((_, i) => String(i)), false, teams, teams.map((_, i) => i), { mode: 'classic' });
  const g = classic(), p = g.players[0]; p.mp = 5000;
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer'), hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  for (const u of [...g.units.values()]) if (!UNITS[u.type].structure && u !== eng) g.units.delete(u.id);
  eng.x = eng.z = 71;
  command(g, 0, { t: 'buy', unit: 'rifle', from: hq.id });
  command(g, 0, { t: 'rally', id: hq.id, x: 41, z: 41 });
  assert.deepEqual(hq.queue, ['rifle'], 'Classic training still uses the production queue');
  assert.deepEqual(hq.rally, { x: 41, z: 41 }, 'Classic rally stays on the selected building');
  assert.equal(snapshotFor(g, 0, []).rally, null, 'Classic has no personal recruit rally');
  command(g, 0, { t: 'dig', ids: [eng.id], x: 71, z: 71, dir: 0 });
  const firstCells = eng.dig.cells.map(([c]) => c);
  command(g, 0, { t: 'dig', ids: [eng.id], queue: true, x: 87, z: 71, dir: 0 });
  assert.equal(eng.orders.length, 1, 'second trench waits behind the first');
  assert.deepEqual(hq.queue, ['rifle'], 'unit orders do not change production');
  for (let i = 0; i < 20 * 20 && eng.dig?.x !== 87; i++) step(g);
  assert.equal(eng.dig?.x, 87, 'Engineers start their second trench');
  assert.ok(firstCells.every(c => g.chars[c] === 'T'), 'first trench is complete before the second starts');
  const secondCells = eng.dig.cells.map(([c]) => c);
  run(g, 12);
  assert.ok(secondCells.every(c => g.chars[c] === 'T'), 'Engineers finish the second trench');
  assert.equal(eng.orders.length, 0, 'both trench orders have finished');

  eng.x = eng.z = 71; run(g, 0.3);
  const mp = p.mp;
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: 71, z: 83 });
  const first = [...g.units.values()].at(-1);
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: 91, z: 83, queue: true });
  const second = [...g.units.values()].at(-1);
  assert.ok(first.type === 'barracks' && second.type === 'barracks' && first.id !== second.id, 'both building sites are placed immediately');
  assert.equal(p.mp, mp - 2 * UNITS.barracks.cost, 'both sites are paid for up front');
  assert.equal(eng.build, first.id, 'first site remains the active work');
  assert.equal(eng.orders.length, 1, 'work on the second site waits');
  assert.equal(second.built, 0, 'queued site has not been constructed');
  for (let i = 0; i < 20 * 65 && eng.build !== second.id; i++) step(g);
  assert.equal(first.built, 1, 'first building finishes before work starts on the second');
  assert.equal(eng.build, second.id, 'Engineers advance to the queued site');
  run(g, 65);
  assert.equal(second.built, 1, 'queued construction finishes');
  first.hp -= 100;
  command(g, 0, { t: 'move', orders: [[eng.id, 71, 101]] });
  command(g, 0, { t: 'assist', ids: [eng.id], id: first.id, queue: true });
  assert.equal(eng.build, 0, 'queued repair does not interrupt movement');
  run(g, 35);
  assert.equal(first.hp, UNITS.barracks.hpPer, 'queued assist repairs the damaged building');

  const transfer = classic([0, 0, 1]);
  const inherited = [...transfer.units.values()].find(u => u.owner === 1 && u.type === 'rifle');
  command(transfer, 1, { t: 'move', orders: [[inherited.id, 71, 71]] });
  command(transfer, 1, { t: 'amove', queue: true, orders: [[inherited.id, 91, 71]] });
  assert.equal(inherited.orders.length, 1, 'eliminated player had a waiting order');
  [...transfer.units.values()].find(u => u.owner === 1 && u.type === 'hq').hp = 0;
  run(transfer, 0.1);
  assert.ok(transfer.players[1].out && inherited.owner === 0, 'surviving teammate receives the army');
  assert.equal(inherited.orders.length, 0, 'ownership transfer clears waiting orders');
}
// Compound clicks preserve the outer queue choice and validate each unit and building owner.
{
  const map = { ...blank(Array(60).fill('.'.repeat(60))), spawns: [{ x: 5, y: 5 }, { x: 50, y: 50 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const own = [...g.units.values()].find(u => u.owner === 0 && u.type === 'rifle'), foreign = [...g.units.values()].find(u => u.owner === 1 && u.type === 'rifle');
  const ownHq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq'), foreignHq = [...g.units.values()].find(u => u.owner === 1 && u.type === 'hq');
  command(g, 0, { t: 'move', orders: [[own.id, 41, 41]] });
  command(g, 1, { t: 'move', orders: [[foreign.id, 81, 81]] });
  const ownRoute = own.path.map(p => ({ ...p })), foreignRoute = foreign.path.map(p => ({ ...p }));
  command(g, 0, { t: 'orders', queue: true, commands: [
    { t: 'move', queue: false, slot: 1, orders: [[own.id, 41, 61], [foreign.id, 41, 61]] },
    { t: 'rally', ids: [ownHq.id, foreignHq.id], x: 61, z: 61 },
  ] });
  assert.deepEqual(own.path, ownRoute, 'compound Shift move preserves the active route');
  assert.deepEqual(own.orders.map(o => [o.t, o.x, o.z]), [['move', 41, 61]], 'outer queue choice overrides the leaf choice');
  assert.deepEqual(ownHq.rally, { x: 61, z: 61 }, 'compound click sets the owned building rally immediately');
  assert.deepEqual(foreign.path, foreignRoute, 'compound move cannot redirect another player\'s squad');
  assert.equal(foreign.orders.length, 0, 'compound move cannot queue another player\'s squad');
  assert.equal(foreignHq.rally, null, 'compound rally cannot change another player\'s building');
  command(g, 0, { t: 'orders', queue: false, commands: [
    { t: 'amove', queue: true, orders: [[own.id, 61, 41]] },
    { t: 'rally', id: ownHq.id, x: 71, z: 71 },
  ] });
  assert.equal(own.orders.length, 0, 'ordinary compound move replaces waiting orders despite the leaf queue flag');
  assert.deepEqual(own.amove, { x: 61, z: 41 }, 'ordinary compound attack-move starts immediately');
  assert.deepEqual(ownHq.rally, { x: 71, z: 71 }, 'ordinary compound click updates its building rally');
}

// Queued house entry completes before a move exits, while an ordinary exit replaces waiting orders.
{
  const rows = [...empty]; rows[10] = '.'.repeat(9) + 'BB' + '.'.repeat(9);
  const g = fresh(rows); g.players[0].mp = 1000;
  const u = put(g, 0, 'rifle', 5, 5);
  command(g, 0, { t: 'move', orders: [[u.id, 5, 17]] });
  command(g, 0, { t: 'garrison', ids: [u.id], x: 19, z: 21, queue: true });
  command(g, 0, { t: 'move', orders: [[u.id, 31, 31]], queue: true });
  assert.deepEqual(snapshotFor(g, 0, []).orders.find(q => q[0] === u.id), [u.id, 2, 9, 19, 21, 1, 31, 31], 'snapshot retains the house entry before its exit move');
  let passedMove = false;
  for (let i = 0; i < 20 * 12 && u.garrison < 0; i++) {
    step(g);
    if (Math.hypot(u.x - 5, u.z - 17) < 1) passedMove = true;
  }
  assert.ok(passedMove && u.garrison >= 0, 'squad visits the first waypoint and enters the queued house');
  assert.equal(u.orders.length, 1, 'exit move waits until house entry is complete');
  run(g, 6);
  assert.equal(u.garrison, -1, 'queued move exits the house');
  assert.ok(Math.hypot(u.x - 31, u.z - 31) < 1, 'queued exit move reaches its destination');
  command(g, 0, { t: 'garrison', ids: [u.id], x: 19, z: 21 });
  run(g, 8);
  assert.ok(u.garrison >= 0, 'squad is back inside before an ordinary exit');
  command(g, 0, { t: 'move', orders: [[u.id, 31, 5]], queue: true });
  command(g, 0, { t: 'amove', orders: [[u.id, 35, 5]], queue: true });
  command(g, 0, { t: 'move', orders: [[u.id, 5, 31]] });
  assert.equal(u.garrison, -1, 'ordinary move exits immediately');
  assert.equal(u.orders.length, 0, 'ordinary exit clears waiting orders');
  run(g, 6);
  assert.ok(Math.hypot(u.x - 5, u.z - 31) < 1, 'ordinary exit reaches its replacement destination');
}

// A full Engineer order queue cannot leave a paid Construction Site without assigned work.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 5, y: 5 }, { x: 70, y: 70 }], points: [{ x: 40, y: 40 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const eng = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  g.players[0].mp = 5000; eng.x = eng.z = 71;
  run(g, 0.3);
  command(g, 0, { t: 'move', orders: [[eng.id, 71, 101]] });
  for (let i = 0; i < 8; i++) command(g, 0, { t: 'move', orders: [[eng.id, 73 + i * 2, 101]], queue: true });
  assert.equal(eng.orders.length, 8, 'Engineer queue is full before construction');
  const mp = g.players[0].mp, count = g.units.size, nextId = g.nextId, terrain = g.chars.join('');
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: 91, z: 83, queue: true });
  assert.equal(g.players[0].mp, mp, 'rejected queued construction spends no MP');
  assert.equal(g.units.size, count, 'rejected queued construction places no site');
  assert.equal(g.nextId, nextId, 'rejected queued construction creates no discarded building');
  assert.equal(g.chars.join(''), terrain, 'rejected queued construction stamps no terrain');
  assert.equal(eng.orders.length, 8, 'rejected construction preserves accepted waiting orders');
  // The same placement must work once the Engineer has queue space.
  command(g, 0, { t: 'stop', ids: [eng.id] });
  command(g, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: 91, z: 83, queue: true });
  const site = [...g.units.values()].at(-1);
  assert.ok(site.type === 'barracks' && site.built === 0, 'the rejected site position was valid');
  assert.equal(g.players[0].mp, mp - UNITS.barracks.cost, 'accepted construction pays exactly once');
  assert.equal(eng.orders[0].id, site.id, 'accepted site has an assigned queued Engineer');
}
// Battlefield readability: contested points obey team vision, and bunker totals never shrink.
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['blue', 'red', 'observer'], false, [0, 1, 2], [0, 1, 2]);
  g.units.clear();
  g.players.forEach(p => { p.mp = 1000; p.spawn = { x: -1000, z: -1000 }; });
  const point = g.points[0];
  const infantry = (owner, x, z) => {
    command(g, owner, { t: 'buy', unit: 'rifle' });
    const u = [...g.units.values()].at(-1);
    Object.assign(u, { x, z, cooldown: 1000 });
    return u;
  };
  const blue = infantry(0, point.x - 1, point.z), red = infantry(1, point.x + 1, point.z);
  step(g);
  assert.equal(point.contested, true, 'two opposing teams contest a point');
  assert.deepEqual(new Set(point.onPoint), new Set([blue.id, red.id]), 'the point remembers only its on-point infantry');
  assert.equal(point.progress, 0, 'contested capture makes no progress');
  assert.equal(snapshotFor(g, 0, []).points[0][3], 1, 'a team seeing both sides receives the contest');
  assert.equal(snapshotFor(g, 2, []).points[0][3], 0, 'a team with no vision of the point receives zero');
  g.players[0].visible.delete(red.id);
  assert.equal(snapshotFor(g, 0, []).points[0][3], 0, 'own infantry do not expose a hidden contesting enemy');
  g.players[2].visible.add(red.id);
  assert.equal(snapshotFor(g, 2, []).points[0][3], 0, 'seeing just one contesting team does not expose the other');
  g.players[2].visible.add(blue.id);
  assert.equal(snapshotFor(g, 2, []).points[0][3], 1, 'a third team seeing both sides can read the contest');
  red.x += CFG.pointRadius * 3;
  step(g);
  assert.equal(point.contested, false, 'the contest clears when one team leaves');
  assert.equal(snapshotFor(g, 0, []).points[0][3], 0, 'cleared contest is sent as zero');
  assert.ok(point.progress > 0, 'the remaining team resumes capture');
  blue.x += CFG.pointRadius * 3;
  step(g);
  assert.equal(point.contested, false, 'an empty point stays uncontested');
  assert.deepEqual(point.onPoint, [], 'an empty point keeps no stale infantry ids');

  const assault = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 1, 1, 0], [0, 1, 2, 0], { mode: 'assault', defenderTeam: 1 });
  const structures = [...assault.units.values()].filter(u => UNITS[u.type].structure);
  assert.equal(assault.mode.total, structures.length, 'Assault records the starting structure count');
  assert.equal(assault.mode.total, 2, 'each defender contributes one starting structure');
  assert.equal(snapshotFor(assault, 0, []).mode.total, 2, 'the Assault snapshot includes its starting total');
  structures[0].hp = 0; step(assault);
  assert.equal(snapshotFor(assault, 0, []).mode.total, 2, 'losing a structure leaves the Assault denominator fixed');

  const annihilation = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 2, 2], [0, 1, 2, 0], { mode: 'annihilation' });
  const bunkers = [...annihilation.units.values()].filter(u => u.type === 'bunker');
  const counts = [0, 0, 0];
  for (const u of bunkers) counts[annihilation.players[u.owner].team]++;
  assert.deepEqual(annihilation.mode.bunkers, counts, 'Annihilation counts starting bunkers by team id');
  assert.deepEqual(snapshotFor(annihilation, 2, []).mode.bunkers, [2, 0, 2], 'all teams receive the static initial counts');
  bunkers[0].hp = 0; step(annihilation);
  assert.deepEqual(snapshotFor(annihilation, 2, []).mode.bunkers, [2, 0, 2], 'losing a bunker leaves the Annihilation denominators fixed');
}
// Unit models (client/unit-models.js): merged parts keep their shape and facing, every unit builds with each
// soldier as one draw, postures blend and keep the weapon above ground, and corpses stay under the cap.
{
  const THREE = await import('three');
  const { mergeParts, mergeMeshes, buildModel, animate, postureOf, POSTURE, LOD, CORPSES, createBodies, PAINT, VEHICLE_PAINT } = await import('./client/unit-models.js');
  const box = new THREE.BoxGeometry(1, 1, 1);
  const merged = mergeParts([{ geo: box, matrix: new THREE.Matrix4().makeTranslation(2, 0, 0) }, { geo: box, matrix: new THREE.Matrix4().makeScale(-1, 2, 1).setPosition(-2, 0, 0) }], false);
  assert.equal(merged.attributes.position.count, 2 * box.attributes.position.count, 'merge keeps every vertex');
  merged.computeBoundingBox();
  assert.deepEqual([merged.boundingBox.min.toArray(), merged.boundingBox.max.toArray()], [[-2.5, -1, -0.5], [2.5, 1, 0.5]], 'merge bakes each part\'s transform');
  const P = merged.attributes.position, N = merged.attributes.normal, I = merged.index, t = [0, 1, 2].map(() => new THREE.Vector3()), n = new THREE.Vector3();
  for (let i = 0; i < I.count; i += 3) {
    t.forEach((p, k) => p.fromBufferAttribute(P, I.getX(i + k)));
    const face = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
    assert.ok(face.dot(n.fromBufferAttribute(N, I.getX(i))) > 0, `triangle ${i / 3} faces outward, also on the mirrored part`);
  }
  const mat = new THREE.MeshLambertMaterial(), bags = [0, 1, 2].map((i) => { const m = new THREE.Mesh(box, mat); m.position.x = i * 3; m.castShadow = true; return m; });
  const one = mergeMeshes(bags);
  assert.ok(one.material === mat && one.castShadow && one.geometry.index.count === 3 * box.index.count, 'scenery merges into one shadow-casting mesh');

  const look = { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 };
  for (const [type, def] of Object.entries(UNITS)) for (const fac of [0, 1, 2, 3]) {
    if (def.air || type === 'airfield') continue; // client/aircraft.js builds the planes and the airfield
    const root = new THREE.Group(), v = { type, root, models: [], turret: null };
    buildModel(v, root, look, fac, def);
    assert.ok(v.models.length, `${type}: has a model`);
    root.traverse((o) => { if (o.isMesh && (o.material === PAINT || o.material === VEHICLE_PAINT)) assert.ok(o.geometry.attributes.matId, `${type}: every painted mesh says what it is made of (model textures)`); });
    if (v.squad) {
      assert.ok(v.models.length >= def.models && v.models.length % def.models === 0, `${type}: whole ranks, a multiple of its ${def.models} models (battalion blocks draw more men)`);
      for (const man of v.models) {
        const { hi, lo } = man.userData;
        assert.ok(hi.length === 1 && lo.length === 1, `${type}: a soldier is one draw near and far`);
        assert.ok(![...hi, ...lo].some((m) => m.castShadow), `${type}: soldiers cast no shadow`);
      }
    } else {
      let draws = 0;
      root.traverse((o) => { if (o.isMesh) { draws++; assert.ok(o.castShadow, `${type}: vehicles and structures cast shadows`); } });
      assert.ok(draws >= 1 && draws <= (type === 'destroyer' ? 5 : 3), `${type}: ${draws} draws`); // a destroyer's four gun mounts each turn on their own
    }
  }

  assert.deepEqual([49, POSTURE.crouch, 89, POSTURE.prone].map((s) => postureOf(s, 0)), [0, 1, 1, 2], 'stand, crouch at 50, prone at 90');
  assert.equal(postureOf(100, 1), 3, 'retreating squads lean even when pinned');
  assert.equal(postureOf(100, 0, 2), 1, 'pinned in a trench: crouch, not out of sight');
  const root = new THREE.Group(), v = { type: 'rifle', root, models: [], x: 0, z: 0, supp: 95, flags: 0, cover: 0 }, eye = new THREE.Vector3(0, 30, 30);
  buildModel(v, root, look, 0, UNITS.rifle);
  animate(v, POSTURE.blend / 2, eye);
  assert.ok(Math.abs(v.squad.w[2] - 0.5) < 0.01, 'halfway to prone after half the blend time');
  animate(v, POSTURE.blend / 2 + 0.01, eye);
  assert.equal(v.squad.w[2], 1, 'prone after the blend time');
  const man = v.models[0];
  man.updateMatrixWorld(true);
  const muzzle = new THREE.Vector3(0.72, 1.1, 0.2).applyMatrix4(man.matrixWorld); // client/fx.js HAND.rifle
  assert.ok(man.userData.pose.rotation.z < -1.3 && muzzle.y > 0.2 && muzzle.y < 0.5, `lying down, weapon just above ground (${muzzle.y.toFixed(2)})`);
  animate(v, 0.016, new THREE.Vector3(0, 0, LOD.high + 10));
  assert.ok(v.squad.far && !man.userData.hi[0].visible && man.userData.lo[0].visible, 'far model beyond the LOD distance');

  // Real travel drives separate stride frames and world-space followers, without changing the squad center.
  const marchRoot = new THREE.Group(), march = { id: 17, type: 'rifle', root: marchRoot, models: [], x: 0, z: 0, supp: 0, flags: 0, cover: 0 };
  buildModel(march, marchRoot, look, 0, UNITS.rifle);
  animate(march, 1 / 60, eye);
  assert.equal(march.models[0].userData.hi[0].morphTargetInfluences.length, 23, 'three suppression/retreat targets plus walk, aim, crouch and crawl frames');
  for (let i = 0; i < 120; i++) { marchRoot.position.x += 0.03; march.x = marchRoot.position.x; animate(march, 1 / 60, eye); }
  const leader = march.models[0].userData, rear = march.models[5].userData;
  assert.ok(leader.motion.blend > 0.9, 'walking enables actual limb locomotion');
  assert.notEqual(leader.motion.phase, rear.motion.phase, 'soldiers have independent stride phases');
  const stride = leader.hi[0].morphTargetInfluences.slice(3);
  marchRoot.position.x += 0.18; march.x = marchRoot.position.x; animate(march, 0.1, eye);
  assert.notDeepEqual(leader.hi[0].morphTargetInfluences.slice(3), stride, 'translation changes the leg/arm frames');
  const beforeTurn = march.models.map((m) => [m.userData.motion.x, m.userData.motion.z]);
  marchRoot.rotation.y = -Math.PI / 2;
  marchRoot.position.z += 0.03; march.z = marchRoot.position.z; animate(march, 1 / 60, eye);
  march.models.forEach((m, i) => assert.ok(Math.hypot(m.userData.motion.x - beforeTurn[i][0], m.userData.motion.z - beforeTurn[i][1]) < 0.9, 'a corner does not spin the whole rank into new slots'));
  assert.ok(new Set(march.models.map((m) => m.userData.motion.localYaw.toFixed(3))).size > 1, 'men turn at individual rates');
  for (let i = 0; i < 60; i++) animate(march, 1 / 60, eye);
  assert.equal(leader.motion.blend, 0, 'idle stops walking');
  const idlePhase = leader.motion.phase;
  animate(march, 0.1, eye); assert.equal(leader.motion.phase, idlePhase, 'idle never marches in place');
  for (const [suppression, posture, firstFrame] of [[50, 1, 15], [95, 2, 19]]) {
    march.supp = suppression;
    for (let i = 0; i < 30; i++) { marchRoot.position.z += 0.015; march.z = marchRoot.position.z; animate(march, 1 / 60, eye); }
    assert.equal(march.squad.w[posture], 1, 'moving suppressed men retain the low posture');
    assert.ok(leader.hi[0].morphTargetInfluences.slice(firstFrame, firstFrame + 4).some((w) => w > 0.1), 'low movement uses crouch walking or crawling limb frames');
    for (let i = 0; i < 60; i++) animate(march, 1 / 60, eye);
    assert.equal(leader.hi[0].morphTargetInfluences[posture - 1], 1, 'idle low figures return to their planted suppression pose');
  }
  const { rigOf, soldierKit, AIM_SHIFT } = await import('./client/models/infantry.js');
  march.cover = 2; march.supp = 100; march.trench = march.models.map(() => [0, 0]);
  animate(march, POSTURE.blend + 0.01, eye, () => -0.9);
  assert.equal(march.squad.w[1], 1, 'trench keeps the crouching posture');
  assert.equal(leader.motion.blend, 0, 'trench seating does not shuffle');
  assert.ok(Math.abs(march.models[0].position.y - (-0.9 - marchRoot.position.y + AIM_SHIFT[1][1] * march.models[0].scale.x)) < 0.001, 'trench men stand on the carved floor, not sunk through the ground');
  const originalSlot = [...leader.slot];
  leader.slot = [originalSlot[0] + 3, originalSlot[1] + 2];
  animate(march, 1 / 60, eye);
  leader.slot = originalSlot; march.trench = null; march.cover = 0; march.supp = 0;
  animate(march, POSTURE.blend + 0.01, eye);
  assert.ok(Math.abs(leader.motion.localX - originalSlot[0]) < 0.000001, 'leaving a destroyed trench restores the stationary home slot');
  march.tgt = 42; march.aim = Math.PI / 2;
  for (let i = 0; i < 30; i++) { marchRoot.position.z += 0.03; march.z = marchRoot.position.z; animate(march, 1 / 60, eye); }
  assert.ok(leader.hi[0].morphTargetInfluences.slice(11, 15).some((w) => w > 0.1), 'moving fire uses aiming gait frames');
  assert.ok(Math.abs(leader.motion.yaw + march.aim) < 0.01, 'moving shooters face their authoritative aim');
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    const aimed = rigOf('rifle', 0, 0, 0, phase), tip = new THREE.Vector3(aimed.info.L, 0, 0).applyMatrix4(aimed.W);
    assert.ok(tip.distanceTo(new THREE.Vector3(0.72, 1.1, 0.2)) < 0.000001, 'the aimed gait keeps the muzzle on the existing flash point');
  }
  for (const phase of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    const rig = rigOf('rifle', 0, 0, 3, phase);
    assert.ok(Math.min(...rig.legs.map((l) => l.ankle.y)) < 0.08, 'one boot remains planted throughout the stride');
    assert.ok(rig.legs.every((l) => l.ankle.y >= 0.04 && l.ankle.y < 0.22), 'boots have bounded ground clearance');
  }

  const bodies = createBodies(), scene = new THREE.Scene(), world = new THREE.Group();
  scene.add(world);
  const deadRoot = new THREE.Group(), dead = { type: 'rifle', root: deadRoot, models: [], turret: null };
  buildModel(dead, deadRoot, look, 0, UNITS.rifle);
  bodies.add(world, 3, 0.2, 4, dead.models[0], 1.2);
  const fallen = world.children.find((o) => o.isInstancedMesh);
  fallen.geometry.computeBoundingBox();
  const bb = fallen.geometry.boundingBox, span = (a) => bb.max[a] - bb.min[a];
  assert.ok(fallen.geometry.attributes.color && fallen.geometry.attributes.matId, 'a corpse keeps the soldier colors and materials');
  assert.ok(fallen.geometry.attributes.position.count > 500 && fallen.geometry.type !== 'CapsuleGeometry', 'a corpse is the soldier mesh, not a capsule');
  assert.ok(Math.max(span('x'), span('z')) > span('y') * 2 && span('y') < 0.85, `a corpse lies down (${span('x').toFixed(2)} x ${span('y').toFixed(2)} x ${span('z').toFixed(2)})`);
  assert.ok(bb.min.y > -0.001 && bb.min.y < 0.02, 'the body rests on the ground');
  const placed = new THREE.Matrix4();
  fallen.getMatrixAt(0, placed);
  const at = new THREE.Vector3().setFromMatrixPosition(placed), facing = new THREE.Euler().setFromRotationMatrix(placed, 'YXZ');
  assert.ok(Math.abs(at.x - 3) < 1e-4 && Math.abs(at.y - 0.2) < 1e-4 && Math.abs(at.z - 4) < 1e-4, 'the corpse is placed where the man fell');
  assert.ok(Math.abs(facing.y - 1.2) < 1e-3, 'it keeps the facing it was given');
  const mgRoot = new THREE.Group(), mg = { type: 'mg', root: mgRoot, models: [], turret: null };
  buildModel(mg, mgRoot, { ...look, color: 0xc43a31 }, 1, UNITS.mg);
  bodies.add(world, 1, 0, 1, mg.models[0], 0);
  const pools = world.children.filter((o) => o.isInstancedMesh);
  assert.equal(pools.length, 2, 'a different uniform gets its own pooled mesh');
  assert.ok(pools[0].geometry !== pools[1].geometry, 'the two pools do not share one body');
  assert.equal(bodies.count, 2, 'both men are on the field');
  let most = 0;
  for (let i = 0; i < 600; i++) { bodies.add(world, i % 50, 0.3, i / 50); bodies.update(0.02); most = Math.max(most, bodies.count); }
  assert.ok(most <= CORPSES.cap && most > CORPSES.cap - 20, `corpses stay at or under the cap (${most})`);
  const drawn = world.children.filter((o) => o.isInstancedMesh).reduce((n, o) => n + o.count, 0);
  assert.equal(drawn, bodies.count, 'the pooled meshes draw every corpse');
  for (let s = 0; s < CORPSES.life + CORPSES.fade + 1; s += 0.5) bodies.update(0.5);
  assert.equal(bodies.count, 0, 'old bodies fade out and leave');
  bodies.add(world, 0, 0, 0); scene.remove(world); bodies.update(0.1);
  assert.equal(bodies.count, 0, 'a finished match empties the pool');

  // drawSoldiers: two rifle squads of one look draw as one instanced mesh per figure; their own meshes leave the camera
  const { drawSoldiers, crowd } = await import('./client/unit-models.js');
  const squads = [0, 1].map((i) => { const r = new THREE.Group(), u = { type: 'rifle', root: r, models: [], x: i * 10, z: 0, supp: 0, flags: 0, cover: 0 }; buildModel(u, r, look, 0, UNITS.rifle); r.position.x = u.x; return u; });
  const cam = new THREE.PerspectiveCamera(42, 1.5, 1, 2200); cam.position.set(5, 30, 40); cam.lookAt(5, 0, 0);
  for (const u of squads) animate(u, 0.1, cam.position);
  drawSoldiers(squads, cam);
  const batches = crowd.children.filter((m) => m.count), men = squads.flatMap((u) => u.models).flatMap((m) => m.userData.hi);
  assert.equal(batches.reduce((n, m) => n + m.count, 0), men.length, 'every man is one instance');
  assert.equal(batches.length, new Set(men.map((m) => m.geometry)).size, 'one draw call per figure');
  assert.ok(men.every((m) => !m.layers.test(cam.layers)), 'the men no longer draw themselves');
  cam.lookAt(5, 0, 400); drawSoldiers(squads, cam);
  assert.ok(crowd.children.every((m) => !m.count), 'squads behind the camera are left out');
  // The mesh the pool instances is the slack fallen build. These squads use their own pools so the two-uniform
  // check above stays a leader and one gunner. Landmarks come from the living aiming prone; the measured mesh is
  // the one createBodies placed.
  const segDist = (p, a, b) => {
    const ab = b.clone().sub(a), t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  };
  const placeCorpse = (type, index, fac, color) => {
    const root = new THREE.Group(), squad = { type, root, models: [], turret: null };
    buildModel(squad, root, { ...look, color }, fac, UNITS[type]);
    const man = squad.models[index], src = man.userData.hi[0].geometry, aim = src.userData.prone;
    assert.ok(aim && src.userData.fallen, `${type} ${index}: the aiming prone stays on the man, and the fallen build is separate`);
    assert.equal(man.userData.hi[0].morphTargetInfluences.length, 23, `${type} ${index}: the fallen pose is not another morph`);
    const pool = createBodies(), field = new THREE.Group();
    pool.add(field, 2, 0.2, 3, man, 0.4);
    const mesh = field.children.find((o) => o.isInstancedMesh);
    assert.ok(mesh && mesh.count === 1, `${type} ${index}: the corpse is instanced`);
    assert.ok(mesh.geometry.attributes.color && mesh.geometry.attributes.matId, `${type} ${index}: corpse keeps colors and materials`);
    assert.ok(mesh.geometry.attributes.position.count > 500 && mesh.geometry.type !== 'CapsuleGeometry', `${type} ${index}: corpse is the soldier mesh, not a capsule`);
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox, wide = (axis) => box.max[axis] - box.min[axis];
    assert.ok(Math.max(wide('x'), wide('z')) > wide('y') * 2 && wide('y') < 0.85, `${type} ${index}: corpse lies down`);
    assert.ok(box.min.y > -0.001 && box.min.y < 0.02, `${type} ${index}: corpse rests on the ground`);
    const placed = new THREE.Matrix4();
    mesh.getMatrixAt(0, placed);
    const at = new THREE.Vector3().setFromMatrixPosition(placed), facing = new THREE.Euler().setFromRotationMatrix(placed, 'YXZ');
    assert.ok(Math.abs(at.x - 2) < 1e-4 && Math.abs(at.y - 0.2) < 1e-4 && Math.abs(at.z - 3) < 1e-4, `${type} ${index}: corpse is placed where he fell`);
    assert.ok(Math.abs(facing.y - 0.4) < 1e-3, `${type} ${index}: corpse keeps the facing it was given`);
    const scale = man.scale.x, P = aim.position, C = mesh.geometry.attributes.position;
    assert.equal(C.count, P.count, `${type} ${index}: corpse vertices match the living man`);
    let minY = Infinity;
    for (let i = 0; i < P.count; i++) minY = Math.min(minY, P.getY(i) * scale);
    const aimAt = (i) => new THREE.Vector3(P.getX(i) * scale, P.getY(i) * scale - minY, P.getZ(i) * scale);
    const corAt = (i) => new THREE.Vector3().fromBufferAttribute(C, i);
    const prone = rigOf(type, fac, index, 2);
    const near = (point, radius) => {
      const idx = [];
      for (let i = 0; i < P.count; i++) if (new THREE.Vector3().fromBufferAttribute(P, i).distanceTo(point) < radius) idx.push(i);
      return idx;
    };
    const chestIdx = near(prone.body.at(new THREE.Vector3(0, 1.02, 0)), 0.12);
    assert.ok(chestIdx.length >= 8, `${type} ${index}: the aiming prone has a chest to measure`);
    const meanY = (idx, pos) => idx.reduce((sum, i) => sum + pos(i).y, 0) / idx.length;
    const chestDrop = meanY(chestIdx, aimAt) - meanY(chestIdx, corAt);
    let elbowMove = 0;
    for (const arm of prone.arms) {
      const idx = near(arm.elbow, 0.07);
      assert.ok(idx.length > 0, `${type} ${index}: the aiming prone has an elbow to measure`);
      let moved = 0;
      for (const i of idx) moved += aimAt(i).distanceTo(corAt(i));
      elbowMove = Math.max(elbowMove, moved / idx.length);
    }
    let handMove = 0;
    for (const arm of prone.arms) {
      const idx = near(arm.hand, 0.06);
      if (!idx.length) continue;
      let moved = 0;
      for (const i of idx) moved += aimAt(i).distanceTo(corAt(i));
      handMove = Math.max(handMove, moved / idx.length);
    }
    let barrel = null;
    if (prone.W) {
      const a = new THREE.Vector3().applyMatrix4(prone.W), b = new THREE.Vector3(prone.info.L, 0, 0).applyMatrix4(prone.W);
      const idx = [];
      for (let i = 0; i < P.count; i++) if (segDist(new THREE.Vector3().fromBufferAttribute(P, i), a, b) < 0.04) idx.push(i);
      assert.ok(idx.length > 4, `${type} ${index}: the aiming prone has a barrel to measure`);
      const aimC = new THREE.Vector3(), corC = new THREE.Vector3();
      for (const i of idx) { aimC.add(aimAt(i)); corC.add(corAt(i)); }
      aimC.multiplyScalar(1 / idx.length); corC.multiplyScalar(1 / idx.length);
      let far = new THREE.Vector3(), best = 0;
      for (const i of idx) {
        const p = corAt(i), dd = p.distanceTo(corC);
        if (dd > best) { best = dd; far = p; }
      }
      barrel = { shift: corC.distanceTo(aimC), dot: Math.abs(far.clone().sub(corC).normalize().dot(b.clone().sub(a).normalize())) };
    }
    return { chestDrop, elbowMove, handMove, barrel, kit: soldierKit(type, index) };
  };
  const rifleman = placeCorpse('rifle', 1, 0, look.color);
  assert.equal(rifleman.kit, 'rifle', 'the checked rifleman is not the squad leader');
  assert.ok(rifleman.chestDrop > 0.08, `a dead rifleman rests his chest lower than the sighting lean (${rifleman.chestDrop.toFixed(3)})`);
  assert.ok(rifleman.elbowMove > 0.2, `a dead rifleman's elbows leave the prone support (${rifleman.elbowMove.toFixed(3)})`);
  assert.ok(rifleman.barrel && rifleman.barrel.shift > 0.3 && rifleman.barrel.dot < 0.45, `a dead rifleman's weapon leaves the aim line (shift ${rifleman.barrel?.shift.toFixed(3)}, dot ${rifleman.barrel?.dot.toFixed(3)})`);
  const ranger = placeCorpse('ranger', 0, 0, look.color);
  assert.ok(ranger.chestDrop > 0.08 && ranger.elbowMove > 0.2, `a dead ranger lies slack, not sighting (chest ${ranger.chestDrop.toFixed(3)}, elbows ${ranger.elbowMove.toFixed(3)})`);
  assert.ok(ranger.barrel && ranger.barrel.shift > 0.3 && ranger.barrel.dot < 0.45, `a dead ranger's weapon leaves the aim line (shift ${ranger.barrel?.shift.toFixed(3)}, dot ${ranger.barrel?.dot.toFixed(3)})`);
  const gunner = placeCorpse('mg', 0, 1, 0xc43a31);
  assert.equal(gunner.kit, 'gunner', 'the crew check is the man who was on the gun');
  assert.ok(gunner.chestDrop > 0.08 && gunner.handMove > 0.25, `a dead gunner is not frozen on an empty grip (chest ${gunner.chestDrop.toFixed(3)}, hands ${gunner.handMove.toFixed(3)})`);
  console.log(`fallen versus aim passed: rifle chest ${rifleman.chestDrop.toFixed(3)} elbows ${rifleman.elbowMove.toFixed(3)} barrel shift ${rifleman.barrel.shift.toFixed(3)} dot ${rifleman.barrel.dot.toFixed(3)}; ranger chest ${ranger.chestDrop.toFixed(3)} elbows ${ranger.elbowMove.toFixed(3)} barrel shift ${ranger.barrel.shift.toFixed(3)} dot ${ranger.barrel.dot.toFixed(3)}; mg chest ${gunner.chestDrop.toFixed(3)} hands ${gunner.handMove.toFixed(3)}`);
}
// Spatial queries keep the brute-force order, including borders, duplicate positions and exact ties.
{
  let seed = 0x519ac;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const units = new Map();
  for (let i = 0; i < 300; i++) units.set(1000 - i, { id: 1000 - i, owner: i % 3, x: i < 10 ? 16 : random() * 256 - 64, z: i < 10 ? 32 : random() * 256 - 64 });
  units.set(0, { id: 0, owner: 2, x: 15, z: 32 });
  units.set(1, { id: 1, owner: 2, x: 17, z: 32 });
  const grid = new SpatialGrid(units), brute = (at, r) => [...units.values()].filter(u => Math.hypot(u.x - at.x, u.z - at.z) <= r);
  for (let i = 0; i < 200; i++) {
    const at = i % 5 ? { x: random() * 256 - 64, z: random() * 256 - 64 } : { x: 16, z: 32 }, r = i % 5 ? random() * 60 : 1;
    assert.deepEqual(grid.radius(at, r), brute(at, r), 'radius query matches Map iteration');
    const match = u => u.owner === i % 3;
    const expected = brute(at, r).filter(match).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0] ?? null;
    assert.equal(grid.nearest(at, r, match), expected, 'nearest query keeps the first exact tie');
  }
  const moved = units.get(1000); moved.x = 112; moved.z = -32; grid.update(moved);
  units.delete(999);
  const added = { id: 4000, owner: 0, x: 112, z: -32 }; units.set(added.id, added); grid.update(added);
  assert.deepEqual(grid.radius(moved, 0), brute(moved, 0), 'live updates include teleports and additions, and exclude removals');
  assert.deepEqual(grid.ownedBy(0), [...units.values()].filter(u => u.owner === 0), 'owner grouping keeps insertion order after movement');

  const g = fresh(); g.players.forEach(p => { p.mp = 1000; });
  const shooter = put(g, 0, 'rifle', 20, 20), first = put(g, 1, 'rifle', 16, 20);
  put(g, 1, 'rifle', 24, 20); step(g);
  assert.equal(shooter.targetId, first.id, 'pickTarget keeps the first equal-score target');
}

// Live separation must discover later pairs brought into range by an earlier push.
{
  const g = fresh(empty, 1); g.players[0].mp = 100000; g.army = { pop: 100, income: 1 };
  for (let i = 0; i < 50; i++) put(g, 0, i % 4 ? 'rifle' : 'tank', 19 + (i % 7) * 0.2, 19 + Math.floor(i / 7) * 0.2).react = 1e9; // no spacing walks: separation alone
  const expected = [...g.units.values()].map(u => ({ ...u }));
  for (let i = 0; i < expected.length; i++) for (let j = i + 1; j < expected.length; j++) {
    const a = expected[i], b = expected[j], min = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d >= min || d === 0) continue;
    const push = (min - d) / 2 * 0.5, px = dx / d * push, pz = dz / d * push;
    a.x -= px; a.z -= pz; b.x += px; b.z += pz;
  }
  step(g);
  assert.deepEqual([...g.units.values()].map(u => [u.x, u.z]), expected.map(u => [u.x, u.z]), 'dense separation preserves exact arithmetic and pair order');
}

// The server's shared snapshot cache gives every player the same wire snapshot as an uncached build. Massive 6-player
// Classic and Conquest run through the real tick loop (serverHarness: a host and five AIs); the round 3 fields (queued
// orders, rally, contested points, the fog lift at the end, Assault and Annihilation totals) are checked too.
{
  const originalRandom = Math.random;
  const h = await serverHarness();
  const { finish } = await import('./shared/sim.js');
  const wire = value => JSON.parse(JSON.stringify(value));
  const same = (g, label) => {
    const shots = g.shots, cells = g.newCells, cache = snapshotCache(g), saved = JSON.stringify(cache.units), out = [];
    for (let slot = 0; slot < g.players.length; slot++) {
      // terrain and fog are each player's own memory (terrainFor and fogFor, outside the cache): the first build takes
      // the pending cells and the fog change
      const cached = wire(snapshotFor(g, slot, shots, cells, cache)), plain = wire(snapshotFor(g, slot, shots, cells));
      assert.deepEqual({ ...cached, cells: undefined, fog: undefined }, { ...plain, cells: undefined, fog: undefined }, `${label}: cached wire snapshot matches player ${slot}`);
      out.push(cached);
    }
    assert.equal(JSON.stringify(cache.units), saved, 'player filtering never mutates shared unit rows');
    return out;
  };
  try {
    let seed = 4916;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (const mode of ['classic', 'conquest']) {
      const code = 'snap' + mode, host = await h.connect(code, { token: code, name: 'host' }), room = h.rooms.get(code);
      for (let i = 1; i < 6; i++) await host.send({ t: 'addAi' });
      for (const [slot, team] of [0, 0, 1, 1, 2, 2].entries()) await host.send({ t: 'team', slot, v: team });
      for (const [slot, faction] of [0, 1, 2, 0, 1, 2].entries()) await host.send({ t: 'faction', slot, v: faction });
      await host.send({ t: 'map', name: 'king-of-the-hill' }); await host.send({ t: 'mode', v: mode }); await host.send({ t: 'army', v: 'massive' });
      // the map loads asynchronously: Start is checked against the current map's seats, so wait until it has switched
      await host.wait('lobby', m => m.mapName === 'king-of-the-hill' && m.mode === mode && m.army === 'massive');
      await host.send({ t: 'start' }); await host.wait('start');
      const g = room.game;
      for (let tick = 0; tick < 1800 && g.winner === null; tick++) {
        await h.tick();
        if (tick >= 1600 && tick % 2) same(g, mode);
      }
      assert.ok(h.snapshots(host).length > 500, `${mode}: the host gets the cached snapshots`);
      if (mode === 'classic') assert.ok([...g.units.values()].some(u => UNITS[u.type].building), 'Classic snapshots include building rows');
      const own = [...g.units.values()].find(u => u.owner === 0 && !UNITS[u.type].structure), before = snapshotFor(g, 0, []);
      own.x += 0.2; own.hp -= 1;
      assert.notDeepEqual(snapshotFor(g, 0, []), before, 'uncached snapshots see changes within the same tick');
      if (mode === 'classic') { await h.clear(code); continue; }

      // queued orders and the rally point, sent over the socket like the client does
      const point = g.points[0], home = g.players[0].spawn, foot = [...g.units.values()].find(u => u.owner === 0 && UNITS[u.type].infantry && u.hp > 0);
      await host.send({ t: 'move', orders: [[foot.id, home.x, home.z]] });
      await host.send({ t: 'move', queue: true, orders: [[foot.id, point.x, point.z]] });
      await host.send({ t: 'rally', x: home.x, z: home.z });
      let rows = same(g, 'orders and rally');
      assert.ok(rows[0].orders.some(o => o[0] === foot.id), 'the cache carries queued orders');
      assert.deepEqual(rows[0].rally, [Math.round(home.x * 10) / 10, Math.round(home.z * 10) / 10], 'the cache keeps the rally point');
      assert.ok(rows.slice(1).every(r => !r.orders.some(o => o[0] === foot.id)), 'nobody else sees those orders');
      // a contested point, read only by a player who sees both teams on it
      const foe = [...g.units.values()].find(u => g.players[u.owner].team !== g.players[0].team && UNITS[u.type].infantry && u.hp > 0);
      Object.assign(point, { contested: true, onPoint: [foot.id, foe.id] });
      g.players[0].visible.add(foe.id);
      rows = same(g, 'contested');
      assert.equal(rows[0].points[0][3], 1, 'the cache keeps the contest for a player who sees it');
      g.players[0].visible.delete(foe.id);
      assert.equal(same(g, 'contested, hidden')[0].points[0][3], 0, 'a hidden contest stays hidden with the cache');
      // the decisive moment lifts the fog; the hold sends cached snapshots too
      finish(g, 1, 'vp', { x: point.x, z: point.z });
      rows = same(g, 'reveal');
      assert.ok(rows[0].units.some(u => g.players[u[2]].team !== g.players[0].team && !g.players[0].visible.has(u[0])), 'the fog lift shows hidden enemies');
      const after = h.snapshots(host).length;
      await h.tick(4);
      assert.ok(h.snapshots(host).slice(after).some(s => s.end?.reason === 'vp'), 'the hold keeps sending snapshots');
      await h.clear(code);
    }
  } finally { Math.random = originalRandom; await h.close(); }
  // starting totals ride the cache too
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  for (const mode of ['assault', 'annihilation']) {
    const g = createGame(map, ['a', 'b', 'c', 'd'], false, [0, 0, 1, 1], [0, 1, 2, 0], mode === 'assault' ? { mode, defenderTeam: 1 } : { mode }), rows = same(g, mode);
    if (mode === 'assault') assert.ok(rows[0].mode.total > 0 && rows[0].mode.total === g.mode.total, 'Assault total in the cached snapshot');
    else assert.ok(rows[0].mode.bunkers.some(n => n > 0) && rows[0].mode.bunkers.join() === g.mode.bunkers.join(), 'Annihilation bunkers in the cached snapshot');
  }
}
// Paths preserve directed cliff edges and reject separated regions without expanding A* nodes.
{
  const rows = empty.map(row => row.slice(0, 10) + 'B' + row.slice(11)), g = fresh(rows);
  const before = g.pathStats?.expansions ?? 0;
  assert.deepEqual(findPath(g, { x: 5, z: 5 }, { x: 35, z: 5 }), [], 'sealed wall has no route');
  assert.equal(g.pathStats.expansions, before, 'different regions reject before A* expansion');
  assert.ok(g.pathStats.regionRejected > 0);
  assert.ok(findPath(g, { x: 21, z: 5 }, { x: 35, z: 5 }).length, 'blocked starts retain the original escape search');
  const failed = g.pathStats.failed;
  assert.deepEqual(findPath(g, { x: 5, z: 5 }, { x: 5, z: 5 }), [], 'a goal in the start cell needs no waypoints');
  assert.equal(g.pathStats.failed, failed, 'a goal in the start cell does not count as a failed path');
  const directed = createGame({ w: 2, h: 2, rows: ['..', '..'], heights: ['02', '21'], spawns: [{ x: 0, y: 0 }], points: [] }, ['a'], false);
  assert.ok(findPath(directed, { x: 3, z: 3 }, { x: 1, z: 1 }).length, 'descending diagonal checks corners from its own level');
  assert.deepEqual(findPath(directed, { x: 1, z: 1 }, { x: 3, z: 3 }), [], 'reverse direction has no legal cliff edge');
}

// Digging changes the vehicle movement mask; destroying the traps opens its region again.
{
  const rows = empty.map((row, y) => y === 10 ? row : row.slice(0, 10) + 'W' + row.slice(11)), g = fresh(rows);
  g.players[0].mp = 5000;
  const crew = put(g, 0, 'rifle', 19, 21), from = { x: 5, z: 21, type: 'tank' }, to = { x: 35, z: 21 };
  assert.ok(findPath(g, from, to).length, 'vehicles cross the open gap');
  const version = g.terrainVersion ?? 0;
  command(g, 0, { t: 'dig', ids: [crew.id], kind: 'traps', x: 21, z: 21, dir: Math.PI / 2 });
  run(g, CFG.digTime + 0.1);
  assert.equal(g.chars[10 * g.w + 10], 'Y', 'digging closes the gap to vehicles');
  assert.ok(g.terrainVersion > version, 'digging invalidates region labels');
  const expansions = g.pathStats.expansions;
  assert.deepEqual(findPath(g, from, to), [], 'new traps separate vehicle regions');
  assert.deepEqual(findPath(g, from, { x: 21, z: 21 }), [], 'a trap cell itself is an unreachable vehicle goal');
  assert.equal(g.pathStats.expansions, expansions, 'vehicle region rejection does not expand A*');
  assert.ok(findPath(g, { ...from, type: 'rifle' }, to).length, 'infantry still cross tank traps');
  g.nades.push({ x: 21, z: 21, t: 0, owner: 0, ab: { radius: 1, inf: 0, veh: 0, supp: 0, terrain: 1000 } });
  step(g);
  assert.equal(g.chars[10 * g.w + 10], '.', 'the normal blast collapses the traps');
  assert.ok(findPath(g, from, to).length, 'collapse restores vehicle connectivity');
}

// Classic footprint placement and collapse invalidate labels that were already queried.
{
  const w = 40, h = 22, rows = Array.from({ length: h }, (_, y) => '.'.repeat(20) + (y >= 8 && y <= 10 ? '.' : 'W') + '.'.repeat(19));
  const g = createGame({ w, h, rows, spawns: [{ x: 2, y: 2 }, { x: 37, y: 19 }], points: [] }, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  g.nodes = []; g.players[0].mp = 5000;
  const crew = [...g.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  crew.x = 37; crew.z = 19;
  const from = { x: 5, z: 19 }, to = { x: 75, z: 19 };
  assert.ok(findPath(g, from, to).length, 'corridor begins open');
  step(g);
  command(g, 0, { t: 'build', ids: [crew.id], kind: 'barracks', x: 41, z: 19 });
  const site = [...g.units.values()].find(u => u.type === 'barracks');
  assert.ok(site, 'a building site is stamped in the corridor');
  assert.deepEqual(findPath(g, from, to), [], 'footprint closes the only corridor');
  command(g, 0, { t: 'stop', ids: [crew.id] });
  site.hp = 0; step(g);
  assert.ok(site.cells.every(c => g.chars[c] === 'R'), 'normal destruction changes the footprint to rubble');
  assert.ok(findPath(g, from, to).length, 'collapsed footprint reopens the corridor');
}

// A blast that lowers a cliff makes a previously unreachable region walkable.
{
  const map = blank(empty); map.heights = empty.map(() => '0'.repeat(10) + '2' + '0'.repeat(9));
  const g = createGame(map, ['a', 'b'], false); g.units.clear(); g.players[0].mp = 1000;
  const from = { x: 5, z: 21 }, to = { x: 35, z: 21 };
  assert.deepEqual(findPath(g, from, to), [], 'two-level cliff separates the map');
  command(g, 0, { t: 'support', kind: 'dive', x: 21, z: 21 });
  run(g, SUPPORT.dive.delay + 0.1);
  assert.equal(g.height[10 * g.w + 10], 0, 'blast lowers the cliff, two levels in the middle of the hole');
  assert.ok(findPath(g, from, to).length, 'height changes invalidate weak regions');
}

// A small path budget serves older requests before repeated requests from earlier unit ids.
{
  const g = fresh(); g.players[0].mp = 5000; g.pathBudget = 1;
  const units = [5, 12, 19, 26].map(z => put(g, 0, 'rifle', 5, z));
  for (const u of units) { u.path = []; u.repath = 0; u.amove = { x: 35, z: u.z }; }
  step(g);
  assert.ok(units[0].path.length, 'first request fits the budget');
  assert.ok(units.slice(1).every(u => !u.path.length), 'overflow waits');
  assert.equal(g.pathStats.deferred, 3, 'each waiting requester joins once');
  units[0].path = []; units[0].repath = 0;
  for (let next = 1; next < units.length; next++) {
    step(g);
    assert.ok(units[next].path.length, `FIFO serves request ${next}`);
    assert.equal(units[0].path.length, 0, 'new requests cannot jump the queue');
  }
  step(g); assert.ok(units[0].path.length, 'the repeated early unit is served after the original overflow');
  g.pathBudget = 0;
  command(g, 0, { t: 'move', orders: [[units[0].id, 8, 5]] });
  assert.ok(units[0].path.length, 'human movement orders remain immediate with no step budget');
}

// Repeated failures drop the same unreachable order, and a new command gets a fresh retry count.
{
  const rows = empty.map(row => row.slice(0, 10) + 'B' + row.slice(11)), g = fresh(rows);
  g.players[0].mp = 1000; g.pathRetryLimit = 3;
  const u = put(g, 0, 'rifle', 5, 5);
  u.amove = { x: 35, z: 5 }; u.repath = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    u.repath = 0; step(g);
    assert.equal(g.pathStats.failed, attempt, 'each retry performs one failed search');
    assert.equal(g.pathStats.dropped, attempt === 3 ? 1 : 0, 'retry cap applies only at its limit');
  }
  assert.equal(u.amove, null, 'failed attack-move order is dropped');
  const calls = g.pathStats.calls; step(g);
  assert.equal(g.pathStats.calls, calls, 'dropped order stops searching');
  command(g, 0, { t: 'amove', orders: [[u.id, 35, 5]] });
  u.repath = 0; step(g);
  assert.ok(u.amove, 'new immediate order resets its earlier failures');
  assert.equal(g.pathStats.dropped, 1, 'fresh order gets its own retry allowance');
}

// The lag recorder: browser numbers are clamped, and the reader blames the right side.
{
  const { cleanClient } = await import('./server/diag.js'), { summarize } = await import('./tools/diag.mjs');
  assert.deepEqual(Object.values(cleanClient([60, -5, 'x', 1e9])).slice(0, 5), [60, 0, null, 1e6, null], 'untrusted numbers are clamped');
  assert.equal(cleanClient('nope'), null);
  const ok = { fps: 60, worst: 20, cpu: 4, snaps: 10, gap: 120, jitter: 5, loss: 0 };
  const line = (tps, players) => ({ tps, tickP95: 2, snapEvery: 2, loopMax: 20, players });
  const lines = Array.from({ length: 6 }, () => line(20, [
    { slot: 0, name: 'fine', on: true, quiet: 1000, bufMax: 500, client: ok },
    { slot: 1, name: 'slowpc', on: true, quiet: 1000, bufMax: 500, client: { ...ok, fps: 20, worst: 200, cpu: 30 } },
    { slot: 2, name: 'badlink', on: true, quiet: 1000, bufMax: 90000, client: { ...ok, gap: 900 } },
    { slot: 3, name: 'silent', on: true, quiet: null, bufMax: 0, client: null }, { slot: 4, ai: true }]));
  const v = summarize(lines).verdicts.join('\n');
  assert.ok(!/fine/.test(v) && !/SERVER/.test(v), 'a healthy player and server get no verdict');
  assert.match(v, /slowpc.*BROWSER.*JavaScript-bound/); assert.match(v, /badlink.*send queue/); assert.match(v, /badlink.*stalls/);
  assert.match(v, /silent.*no pings/); assert.ok(!/silent.*BROWSER/.test(v), 'no numbers is not a slow browser');
  assert.match(summarize([line(16, [])]).verdicts[0], /SERVER/, 'a slow tick rate blames the server');
}

// Snapshot cadence reduces load, then recovers only after sustained spare capacity.
{
  const { createTickMeter, recordTick, tickStats } = await import('./tickmeter.js');
  const meter = createTickMeter({ snapshotSize: 10 });
  const sample = (tick) => ({ tick, step: tick / 2, think: 1, snapshot: tick / 2 - 1,
    snapshotBuild: 2, snapshotStringify: 1, sent: true });
  const feed = (from, to, tick) => { for (let now = from; now <= to; now += 100) recordTick(meter, sample(tick), now); };
  assert.equal(meter.snapEvery, 2, 'rooms begin with 10 Hz snapshots');
  feed(100, 1000, 45);
  assert.equal(meter.snapEvery, 3, 'snapshot tick p95 above 40 ms stretches to 3 ticks');
  feed(1100, 2000, 45);
  assert.equal(meter.snapEvery, 4, 'continued load stretches to 4 ticks');
  feed(2100, 3000, 12);
  feed(3100, 12900, 12);
  assert.equal(meter.snapEvery, 4, 'recovery waits 10 seconds below 24 ms');
  feed(13000, 13000, 12);
  assert.equal(meter.snapEvery, 3, 'recovery lowers cadence one step');
  feed(13100, 22900, 12);
  assert.equal(meter.snapEvery, 3, 'each recovery step has its own sustained wait');
  feed(23000, 24000, 12);
  assert.equal(meter.snapEvery, 2, 'sustained recovery restores 10 Hz');
  assert.equal(tickStats(meter).snapshotTick.p95, 12, 'snapshot ring expires old expensive ticks');

  const noisy = createTickMeter({ snapshotSize: 50 });
  for (let now = 100; now <= 5000; now += 100) recordTick(noisy, sample(now === 4100 ? 100 : 12), now);
  assert.equal(noisy.snapEvery, 2, 'one isolated spike does not stretch the interval');
  assert.equal(tickStats(noisy).snapshotTick.p95, 12, 'p95 ignores an isolated outlier');

  const interrupted = createTickMeter({ snapshotSize: 10 });
  for (let now = 100; now <= 2000; now += 100) recordTick(interrupted, sample(45), now);
  for (let now = 2100; now <= 9000; now += 100) recordTick(interrupted, sample(12), now);
  for (let now = 9100; now <= 10000; now += 100) recordTick(interrupted, sample(30), now);
  for (let now = 10100; now <= 20000; now += 100) recordTick(interrupted, sample(12), now);
  assert.equal(interrupted.snapEvery, 4, 'a moderate load interrupts the recovery wait');
  recordTick(interrupted, sample(12), 21000);
  assert.equal(interrupted.snapEvery, 3, 'recovery starts again after interrupted low-load period');
}

// Relief preserves the sim's plateaus and boundaries on every shipped map.
{
  for (const file of readdirSync('maps').filter(f => f.endsWith('.json'))) {
    const map = JSON.parse(readFileSync('maps/' + file, 'utf8')), grid = map.rows.map(r => [...r]);
    const relief = createRelief(map, grid, { low: false }), geo = relief.geometry, p = geo.attributes.position.array, idx = geo.index.array;
    const lv = (x, y) => levelOf(map.heights?.[y]?.[x] ?? '0') * CFG.levelHeight;
    const plain = new Uint8Array(map.w * map.h);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      let bank = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ('WF='.includes(grid[y + dy]?.[x + dx] ?? '!')) bank = true;
      const dug = grid[y][x] === 'T'; // trench cells are carved TRENCH_DEPTH below their level
      plain[y * map.w + x] = bank || dug ? 0 : 1;
      const height = relief.hAt((x + 0.5) * CELL, (y + 0.5) * CELL);
      assert.ok(Number.isFinite(height), `${file}: finite centre ${x},${y}`);
      if (!bank || grid[y][x] === '=') assert.ok(Math.abs(height - lv(x, y) + (dug ? TRENCH_DEPTH : 0)) <= 0.1, `${file}: nominal centre ${x},${y}`);
    }
    for (const attr of Object.values(geo.attributes)) assert.ok(attr.array.every(Number.isFinite), `${file}: finite geometry`);
    let degenerate = false;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 1e-9) { degenerate = true; break; }
    }
    assert.ok(!degenerate, `${file}: nondegenerate triangles`);
    assert.ok(idx.length / 3 <= Math.max(150000, map.w * map.h), `${file}: terrain triangle ceiling`); // maps over 256 cells: one per cell
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= map.w || ny >= map.h) continue;
      const a = lv(x, y), b = lv(nx, ny), diff = Math.abs(b - a), sample = t => relief.hAt((x + 0.5 + dx * t) * CELL, (y + 0.5 + dy * t) * CELL);
      if (diff < 2 * CFG.levelHeight) for (let k = 1; k < 4; k++) {
        const ex = (x + (dx ? 1 : k / 4)) * CELL, ez = (y + (dy ? 1 : k / 4)) * CELL;
        assert.ok(Math.abs(relief.hAt(ex - dx * 1e-7, ez - dy * 1e-7) - relief.hAt(ex + dx * 1e-7, ez + dy * 1e-7)) <= 1e-4, `${file}: closed noncliff edge ${x},${y}`);
      }
      if (!plain[y * map.w + x] || !plain[ny * map.w + nx]) continue;
      if (diff >= 2 * CFG.levelHeight) {
        assert.ok(Math.abs(sample(0.4999) - a) <= 0.1 && Math.abs(sample(0.5001) - b) <= 0.1, `${file}: cliff boundary ${x},${y}`);
      } else if (diff === CFG.levelHeight) {
        const sign = Math.sign(b - a); let previous = sample(0);
        for (let k = 1; k <= 8; k++) { const next = sample(k / 8); assert.ok((next - previous) * sign >= -1e-4, `${file}: monotonic slope ${x},${y}`); previous = next; }
        assert.ok(Math.abs(sample(0.5) - (a + b) / 2) <= 0.1, `${file}: centred slope ${x},${y}`);
      } else {
        assert.ok(Math.abs(sample(0.4999) - sample(0.5001)) <= 0.01, `${file}: shared noncliff edge ${x},${y}`);
      }
    }
    relief.dispose();
  }

  // A stick of bombs keeps sim heights at cell centres. The banks have to leave the cell grid.
  {
    const W = 36, H = 18;
    const height = new Int8Array(W * H);
    const chars = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
    const cellOf = (x, z) => {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) return -1;
      return cz * W + cx;
    };
    const center = (c) => ({ x: (c % W + 0.5) * CELL, z: (Math.floor(c / W) + 0.5) * CELL });
    const dent = (c) => {
      if (c < 0) return;
      const L = height[c] - 1, x = c % W;
      const ns = [c - W, c + W, x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1];
      if (L < -2 || ns.some(n => n >= 0 && n < height.length && height[n] - L > 1)) return;
      height[c] = L;
    };
    const digAt = (at, r) => {
      const n = Math.ceil(r / CELL), hole = [cellOf(at.x, at.z)];
      for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
        const c = cellOf(at.x + dx * CELL, at.z + dy * CELL);
        if (c >= 0 && c !== hole[0] && Math.hypot(center(c).x - at.x, center(c).z - at.z) <= r) hole.push(c);
      }
      for (const c of hole) { dent(c); if (chars[Math.floor(c / W)][c % W] === '.') chars[Math.floor(c / W)][c % W] = '+'; }
      if (r > 0) for (const c of hole) if (Math.hypot(center(c).x - at.x, center(c).z - at.z) <= r / 2) dent(c);
    };
    const jitter = [0.4, -1.1, 0.8, -0.3, 1.2, -0.6];
    for (let i = 0; i < 6; i++) digAt({ x: 36 + (i / 5 - 0.5) * 40, z: 22 + jitter[i] }, 4.2);
    const levelChar = (L) => (L >= 0 ? String(L) : String.fromCharCode(96 - L));
    const rows = chars.map(row => row.join(''));
    const heights = Array.from({ length: H }, (_, z) => Array.from({ length: W }, (_, x) => levelChar(height[z * W + x])).join(''));
    const grid = rows.map(r => [...r]);
    const stick = createRelief({ w: W, h: H, rows, heights, spawns: [{ x: 2, y: 2 }] }, grid, { low: false });
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const got = stick.hAt((x + 0.5) * CELL, (z + 0.5) * CELL);
      assert.ok(Math.abs(got - levelOf(heights[z][x]) * CFG.levelHeight) <= 0.1, `stick centre ${x},${z}`);
    }
    const p = stick.geometry.attributes.position.array, idx = stick.geometry.index.array;
    let tris = 0, down = 0, degenerate = false;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const area = Math.hypot(cx, cy, cz);
      tris++;
      if (area <= 1e-9) degenerate = true;
      else if (cy < -0.35 * area) down++;
    }
    assert.ok(!degenerate, 'stick: degenerate triangle');
    assert.ok(down / tris < 0.02, `stick: folded surface ${down}/${tris}`);
    const bank = (side) => {
      const bins = Array.from({ length: 24 }, () => []);
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (y < -0.85 || y > -0.02 || x < 14 || x > 62) continue;
        if (side < 0 ? z >= 22 : z < 22) continue;
        bins[Math.max(0, Math.min(23, Math.floor((x - 14) / 2)))].push(z);
      }
      let off = 0, n = 0;
      for (const zs of bins) {
        if (!zs.length) continue;
        const z = side < 0 ? Math.min(...zs) : Math.max(...zs);
        const f = Math.abs(z % 0.5);
        off += Math.min(f, 0.5 - f);
        n++;
      }
      return { off, n };
    };
    const north = bank(-1), south = bank(1);
    assert.ok(north.n >= 8 && south.n >= 8, 'stick: the rim is missing');
    assert.ok(north.off > 0.7 && south.off > 0.7, `stick: banks still sit on the cell grid (${north.off.toFixed(2)}, ${south.off.toFixed(2)})`);
    stick.dispose();
  }
}

// Weather (shared/weather.js): the plan is the same for the same seed, it turns on time after a public warning, and
// the effects reach movement and sight through one multiplier each. Rain is the living ground's rain held on all
// match, and the showers follow the match weather. Fog of war stays on the server: shorter sight sends fewer enemy rows.
{
  const { planWeather, weatherRow, weatherSpeed, roadMask, WEATHER, WEATHER_KINDS, WEATHER_WARN } = await import('./shared/weather.js');
  const plain = blank(empty);
  for (let seed = 0; seed < 50; seed++) assert.deepEqual(planWeather('random', plain, 'x', seed), planWeather('random', plain, 'x', seed), 'weather: the same seed gives the same plan');
  const plans = Array.from({ length: 300 }, (_, seed) => planWeather('random', plain, 'x', seed));
  for (const k of WEATHER_KINDS) assert.ok(plans.some(p => p.now === k), `weather: Random can pick ${k}`);
  assert.ok(plans.some(p => p.next) && plans.some(p => !p.next), 'weather: Random sometimes turns once, sometimes holds');
  for (const p of plans.filter(p => p.next)) {
    assert.ok((p.now === 'fog' && p.next === 'clear' && p.at >= 210 * 20 && p.at <= 270 * 20) || (p.now === 'rain' && p.next === 'mud' && p.at >= 300 * 20 && p.at <= 420 * 20), `weather: only fog lifts or rain turns to mud, on time (${JSON.stringify(p)})`);
  }
  assert.deepEqual(planWeather('snow', plain, 'x', 7), { now: 'snow', next: null, at: 0 }, 'weather: a host pick holds all match');
  assert.deepEqual(planWeather('map', { ...plain, name: 'Ardennes Crossing' }, 'ardennes-crossing'), { now: 'snow', next: null, at: 0 }, 'weather: a winter map snows by default');
  assert.deepEqual(planWeather('map', { ...plain, name: 'Pegasus Bridge' }, 'pegasus-bridge'), { now: 'fog', next: 'clear', at: 240 * 20 }, 'weather: a river dawn starts in fog that lifts after 4 minutes');
  assert.deepEqual(planWeather('map', { ...plain, weather: 'rain' }, 'x'), { now: 'rain', next: null, at: 0 }, 'weather: a map file can name its weather');
  assert.deepEqual(planWeather('map', plain, 'x'), { now: 'clear', next: null, at: 0 }, 'weather: other maps are clear');
  const twin = (seed) => createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: 'random', weatherSeed: seed }).weather;
  assert.deepEqual(twin(12345), twin(12345), 'weather: createGame with the same seed plans the same weather');
  assert.deepEqual(planWeather('__proto__', plain, 'x', 7), { now: 'clear', next: null, at: 0 }, 'weather: a made-up setting falls back to the map default');
  assert.deepEqual(planWeather('map', { ...plain, weather: 'constructor' }, 'x'), { now: 'clear', next: null, at: 0 }, 'weather: a map file naming no real weather is clear');
  // only Random draws a random number, so every other weather leaves the sim's random stream (and a seeded bench run) as it was
  const randomCalls = (opts) => { let n = 0; const real = Math.random; Math.random = () => (n++, real()); try { createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], opts); } finally { Math.random = real; } return n; };
  const base = randomCalls({ weather: false }); // createGame's own draws (the living ground's dice seed)
  assert.equal(randomCalls({}), base, 'weather: Map default uses no random numbers');
  assert.equal(randomCalls({ weather: 'fog' }), base, 'weather: a host pick uses no random numbers');
  assert.equal(randomCalls({ weather: 'random' }), base + 1, 'weather: Random draws its seed');

  // Rain is the living ground's rain all match, on soaked ground; Snow never rains; elsewhere showers come and go
  assert.equal(WEATHER.rain.sight, 1 - CFG.weather.sight, 'weather: the Rain the lobby describes cuts sight as the sim rain does');
  assert.equal(WEATHER.rain.offRoad, 1 - CFG.weather.wetGround, 'weather: and slows vehicles off roads as soaked ground does');
  assert.equal(WEATHER.mud.offRoad, 1 - CFG.weather.wetGround, 'weather: Mud slows vehicles off roads as soaked ground does');
  const bog = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: 'mud' });
  assert.equal(bog.wx.wet, 1, 'weather: a Mud match starts on soaked ground');
  bog.wx.next = 0; run(bog, 5); bog.wx.raining = false; run(bog, 30);
  assert.equal(bog.wx.wet, 1, 'weather: and it stays soaked after a shower passes');
  const wet = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: 'rain' });
  assert.deepEqual([wet.wx.raining, wet.wx.rain, wet.wx.wet], [true, 1, 1], 'weather: a Rain match starts raining on soaked ground');
  wet.wx.next = 0; run(wet, 30);
  assert.deepEqual([wet.wx.raining, wet.wx.rain], [true, 1], 'weather: and the rain never lets up');
  wet.weather = { now: 'mud', next: null, at: 0 }; run(wet, 25);
  assert.ok(!wet.wx.raining && wet.wx.rain === 0 && wet.wx.wet === 1, 'weather: when Rain turns to mud the rain stops and the ground stays soaked');
  const winter = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: 'snow' });
  winter.wx.next = 0; run(winter, 5);
  assert.ok(!winter.wx.raining && winter.wx.rain === 0, 'weather: no showers in snow');
  const fair = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: 'clear' });
  fair.wx.next = 0; run(fair, 5);
  assert.ok(fair.wx.raining && fair.wx.rain > 0, 'weather: in Clear a shower can still come');

  // the one change: silent until WEATHER_WARN seconds before, then announced in every snapshot, then it happens
  const g = fresh();
  assert.deepEqual(snapshotFor(g, 0, []).weather, ['clear'], 'weather: the test map is clear');
  g.weather = { now: 'fog', next: 'clear', at: g.tick + 30 * 20 };
  run(g, 30 - WEATHER_WARN - 1);
  assert.deepEqual(weatherRow(g), ['fog'], 'weather: no warning too early');
  run(g, 2);
  const warned = snapshotFor(g, 1, []).weather;
  assert.equal(warned[0], 'fog'); assert.equal(warned[1], 'clear');
  assert.ok(warned[2] > 0 && warned[2] <= WEATHER_WARN, 'weather: everyone hears about the change seconds ahead');
  assert.deepEqual(snapshotFor(g, 0, []).weather, warned, 'weather: the warning is public');
  run(g, WEATHER_WARN);
  assert.deepEqual(snapshotFor(g, 0, []).weather, ['clear'], 'weather: the fog lifts on time');

  // movement: how far a unit gets in 3 s, by weather (roads: every cell a road, the sim's own D cells)
  const travel = (kind, type, roads = false) => {
    const g = fresh(roads ? Array(20).fill('D'.repeat(20)) : empty); g.players[0].mp = 1000;
    g.weather = { now: kind, next: null, at: 0 };
    if (kind === 'rain') Object.assign(g.wx, { raining: true, rain: 1, wet: 1 }); // as createGame starts a Rain match
    if (kind === 'mud') g.wx.wet = 1; // and a Mud match
    const u = put(g, 0, type, 4, 20);
    command(g, 0, { t: 'move', orders: [[u.id, 38, 20]] });
    run(g, 3);
    return u.x - 4;
  };
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.03, `${what}: ${a.toFixed(3)} vs ${b}`);
  const tank = travel('clear', 'tank'), rifle = travel('clear', 'rifle'), tankRoad = travel('clear', 'tank', true);
  assert.ok(tank > 5 && rifle > 5, 'weather: units move in clear weather');
  // (the tank churns the soaked ground it drives on, as in the living-ground test, hence the wider margin)
  assert.ok(Math.abs(travel('rain', 'tank') / tank - 0.8) < 0.06, 'weather: rain slows vehicles off roads by 20%');
  near(travel('rain', 'tank', true) / tankRoad, 1, 'weather: rain does not slow vehicles on roads');
  near(travel('rain', 'rifle') / rifle, 1, 'weather: rain does not slow infantry');
  assert.ok(Math.abs(travel('mud', 'tank') / tank - 0.8) < 0.06, 'weather: mud slows vehicles off roads by 20% (the soaked ground)');
  near(travel('mud', 'rifle') / rifle, 0.9, 'weather: mud slows infantry by 10%');
  near(travel('snow', 'tank') / tank, 0.85, 'weather: snow slows vehicles by 15%');
  near(travel('mud', 'tank', true) / tankRoad, 1, 'weather: mud does not slow vehicles on roads');
  // no double penalty: on the map's own mud cells, Mud weather is the same soaked mud as a Clear day after a long shower
  const sink = (kind) => {
    const g = fresh(Array(20).fill('M'.repeat(20))); g.players[0].mp = 1000;
    g.weather = { now: kind, next: null, at: 0 }; g.wx.wet = 1; g.wx.next = 1e9; g.wear.fill(0.5); // the same depth in both
    const u = put(g, 0, 'tank', 4, 20); command(g, 0, { t: 'move', orders: [[u.id, 38, 20]] }); run(g, 3);
    return u.x - 4;
  };
  near(sink('mud') / sink('clear'), 1, 'weather: Mud adds nothing to a mud cell that the soaked ground has not');
  near(travel('snow', 'tank', true) / tankRoad, 0.85, 'weather: snow slows vehicles on roads too');
  near(travel('snow', 'rifle') / rifle, 0.9, 'weather: snow slows infantry by 10%');
  near(travel('fog', 'tank') / tank, 1, 'weather: fog does not slow anyone');
  assert.equal(weatherSpeed({ weather: { now: 'snow' } }, UNITS.fighter), 1, 'weather: planes fly over the weather');
  // the look's roads follow the ground painter: open ground by a house, not by water; bridges and roads
  const village = roadMask({ w: 5, h: 3, rows: ['.B...', '.....', 'W=.D+'] });
  assert.deepEqual([...village], [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0], 'weather: road cells follow the village, the bridge and the road');

  // sight: enemies 10, 20, 28 and 33 m from a rifle squad (vision 36 m); fog (25 m) sees two, rain (29 m) three
  const sees = (kind) => {
    const g = fresh(); g.players[0].mp = g.players[1].mp = 1000;
    g.weather = { now: kind, next: null, at: 0 };
    if (kind === 'rain') Object.assign(g.wx, { raining: true, rain: 1, wet: 1 });
    put(g, 0, 'rifle', 4, 20);
    const foes = [10, 20, 28, 33].map(dx => put(g, 1, 'rifle', 4 + dx, 20));
    run(g, 0.5);
    const rows = snapshotFor(g, 0, []).units;
    return { rows: rows.length, ids: foes.filter(f => rows.some(r => r[0] === f.id)).map(f => Math.round(f.x - 4)) };
  };
  const clear = sees('clear'), fog = sees('fog'), rain = sees('rain'), snow = sees('snow');
  assert.deepEqual(clear.ids, [10, 20, 28, 33], 'weather: clear weather sees all four');
  assert.deepEqual(fog.ids, [10, 20], 'weather: ground fog cuts sight by 30%');
  assert.deepEqual(rain.ids, [10, 20, 28], 'weather: rain cuts sight by 20%');
  assert.deepEqual(snow.ids, [10, 20, 28], 'weather: snow cuts sight by 10%');
  assert.ok(fog.rows < rain.rows && rain.rows < clear.rows, 'weather: shorter sight sends fewer snapshot rows (server-side fog of war)');
}
// Horde: one shared HQ and bunker, waves from the attacker spawns, the break only after a wave is dead.
{
  const map = { name: 'Horde fixture', w: 60, h: 60, rows: Array(60).fill('.'.repeat(60)), spawns: [{ x: 30, y: 5 }, { x: 10, y: 54 }, { x: 50, y: 54 }], defend: [0], points: [{ x: 30, y: 30 }] };
  const g = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'horde' });
  const H = CFG.horde, m = g.mode, bunker = g.units.get(m.bunker), horde = () => [...g.units.values()].filter(u => u.owner === m.slot);
  assert.deepEqual(g.players.map(p => [p.name, p.team]), [['a', 0], ['b', 0], ['Horde', 1]], 'Horde adds the horde as the last player and puts everyone else on one team');
  assert.equal(g.players[2].faction, 2, 'the horde wears a faction no defender picked');
  assert.deepEqual(g.players[0].spawn, g.players[1].spawn, 'Horde defenders share one HQ');
  assert.equal([...g.units.values()].filter(u => u.type === 'bunker').length, 1, 'Horde has one shared bunker');
  assert.ok(m.gates.length === 2 && !horde().length && g.players[2].mp === 0, 'the horde starts with nothing, at the attacker spawns');
  step(g);
  assert.ok(!m.active && m.wave === 0 && snapshotFor(g, 0, []).mode.timeLeft === Math.ceil(H.break - 0.05), 'Horde opens with a break');
  m.timeLeft = 0; for (let i = 0; i < 40; i++) step(g);
  assert.ok(m.active && m.wave === 1 && m.left > 0 && horde().length > 0, 'wave 1 walks on when the break ends');
  // each takes its own spot around the bunker (unit behavior: settle within coverSeek, then step off a held spot)
  assert.ok(horde().every(u => u.amove && Math.hypot(u.amove.x - bunker.x, u.amove.z - bunker.z) <= 2 * CFG.behavior.coverSeek + 2), 'every horde unit attack-moves on the bunker');
  assert.equal(g.players[2].inc, 0, 'the horde has no income');
  // the wave's make-up: within budget, only what is unlocked, never snipers
  const cost = (list) => list.reduce((a, t) => a + UNITS[t].cost, 0);
  for (let i = 0; i < 20; i++) {
    const w1 = sim.hordeWave(1, 2), w9 = sim.hordeWave(9, 3, 3), budget9 = H.budget * H.growth ** 8 * 9;
    assert.ok(cost(w1) <= H.budget * 2 && cost(w1) > H.budget * 2 - 100 && w1.every(t => t === 'rifle' || t === 'conscript'), 'wave 1 spends its budget on rifles and conscripts');
    assert.ok(cost(w9) <= budget9 && cost(w9) > budget9 - 100 && !w9.includes('tiger') && !w9.includes('sniper'), 'wave 9 scales with defenders and army size and holds no Tiger or sniper');
  }
  // the horde's AI neither shops nor retreats
  const count = g.units.size; g.players[2].mp = 5000;
  const hurtOne = horde()[0]; hurtOne.hp = 1;
  think(g, m.slot);
  assert.ok(g.units.size === count && !hurtOne.retreating, 'the horde AI buys nothing and never retreats');
  g.players[2].mp = 0;
  // the last few are revealed through the fog
  m.reserve = []; m.budget = 0;
  const last = horde()[0];
  for (const u of horde()) if (u !== last) g.units.delete(u.id);
  Object.assign(last, { x: 5, z: 115, hp: UNITS[last.type].models * UNITS[last.type].hpPer, path: [], amove: null });
  for (let i = 0; i < 5; i++) step(g);
  assert.ok(m.left === 1 && g.players[0].visible.has(last.id), 'the last of a wave show through the fog');
  // wave dead: break, bunker patched up, bounty paid to the killer but never to the horde
  bunker.hp = 1000; last.hp = 0; last.lastHit = 0;
  const before = g.players[0].mp;
  step(g);
  assert.ok(!m.active && m.timeLeft === H.break && bunker.hp === 1000 + UNITS.bunker.hpPer * H.heal, 'a dead wave starts the break and patches the bunker');
  assert.ok(g.players[0].mp - before >= UNITS[last.type].cost * CFG.bounty, 'killing horde units pays the Kill Bounty');
  for (let i = 0; i < 40; i++) step(g);
  assert.ok(!m.active && m.wave === 1, 'the next wave waits out the break');
  // the run ends when the bunker falls
  bunker.hp = 0; step(g); step(g);
  assert.ok(g.winner === 1 && g.endReason === 'structures', 'Horde ends when the bunker falls');
  // no defender spawns, or no free seat for the horde: not a horde game
  const { defend, ...plain } = map;
  assert.equal(createGame(plain, ['a'], false, [0], [0], { mode: 'horde' }).mode, undefined, 'Horde needs a map with defender spawns');
  assert.equal(createGame(map, ['a', 'b', 'c', 'd', 'e', 'f'], false, undefined, undefined, { mode: 'horde' }).players.length, 6, 'Horde needs a free seat for the horde');
}

// Horde start and restart refuse a freshly edited map without defender spawns.
{
  const map = { name: 'Horde edited fixture', w: 60, h: 60, rows: Array(60).fill('.'.repeat(60)), spawns: [{ x: 30, y: 5 }, { x: 10, y: 54 }, { x: 50, y: 54 }], defend: [0], points: [{ x: 30, y: 30 }] };
  const { defend, ...plain } = map;
  assert.equal(validateMap(map), null); assert.equal(validateMap(plain), null, 'the edit keeps a valid map');
  const h = await serverHarness(), code = 'hordeedit'; h.useMap(JSON.stringify(map));
  const host = await h.connect(code, { token: code, name: 'Host' }), room = h.rooms.get(code);
  await host.send({ t: 'mode', v: 'horde' });
  await h.waitFor(() => host.lobby().mode === 'horde', 'Horde selected');
  const guest = await h.connect(code, { token: code + 'guest', name: 'Guest' });
  h.useMap(JSON.stringify(plain));
  await host.send({ t: 'start' }); await h.settleServer();
  assert.equal(room.state, 'lobby', 'an invalid Horde Start stays in the lobby');
  assert.equal(room.game, null, 'no Conquest game is created');
  assert.equal(host.messages.filter(m => m.t === 'start').length, 0, 'no start message is sent');
  h.useMap(JSON.stringify(map));
  await host.send({ t: 'start' }); await host.wait('start'); await guest.wait('start');
  const game = room.game, matchId = room.matchId;
  h.useMap(JSON.stringify(plain));
  await host.send({ t: 'restart' }); await h.settleServer();
  assert.equal(room.game, game, 'an invalid Restart preserves the running Horde game');
  assert.equal(room.matchId, matchId, 'a refused Restart does not start a new match');
  assert.equal(host.messages.filter(m => m.t === 'start').length, 1, 'no replacement start message is sent');
  assert.equal(room.mode, 'horde', 'the selected mode stays Horde');
  h.holdMaps();
  await host.send({ t: 'restart' });
  assert.equal(room.game, null, 'Restart is waiting for the map load');
  await guest.close(); h.releaseMaps();
  await h.waitFor(() => room.game === game, 'refused Restart restores the game');
  assert.equal(room.pause?.reason, 'drop', 'a disconnect during the refused Restart still pauses the restored game');
  await h.close();
}

// Horde reserves bound purchases per tick and memory while preserving ordinary wave strength.
{
  const map = { w: 60, h: 60, rows: Array(60).fill('.'.repeat(60)), spawns: [{ x: 30, y: 5 }, { x: 10, y: 54 }, { x: 50, y: 54 }], defend: [0], points: [] };
  const make = (n, army = 'standard') => createGame(map, Array(n).fill('Defender'), false, Array(n).fill(0), Array(n).fill(0), { mode: 'horde', army });
  const g = make(5, 'massive'), m = g.mode, random = Math.random;
  m.wave = 39; m.timeLeft = 0;
  let rolls = 0;
  try { Math.random = () => { rolls++; return 0.5; }; step(g); }
  finally { Math.random = random; }
  assert.ok(m.reserve.length <= CFG.horde.fieldMax, 'wave 40 keeps a fixed reserve buffer');
  assert.ok(rolls < 1000, 'a large wave makes only bounded purchases in one tick');
  assert.ok(Number.isFinite(m.budget) && m.budget > 0, 'the rest of the wave stays as unspent budget');
  for (let i = 0; i < 12; i++) {
    step(g);
    assert.ok(m.reserve.length <= CFG.horde.fieldMax, 'later ticks cannot grow the buffer past its cap');
  }
  for (const u of g.units.values()) if (u.owner === m.slot) g.units.delete(u.id);
  m.reserve = []; step(g);
  assert.ok(m.active && m.left > CFG.horde.reveal, 'unspent budget prevents early wave completion or final-three reveal');

  const normal = make(3), n = normal.mode;
  for (const u of normal.units.values()) { u.holdFire = true; u.auto = false; }
  n.wave = 8; n.timeLeft = 0;
  try {
    Math.random = () => 0.5;
    const expected = sim.hordeWave(9, 3);
    for (let i = 0; !n.active || n.budget > 0; i++) { assert.ok(i < 100, 'normal wave generation finishes promptly'); step(normal); }
    const actual = [...n.reserve, ...[...normal.units.values()].filter(u => u.owner === n.slot && !u.air).map(u => u.type)];
    assert.deepEqual(actual.sort(), expected.sort(), 'ordinary waves buy the same weighted units for the same budget');
  } finally { Math.random = random; }
  const extreme = make(1); extreme.mode.wave = 3999; extreme.mode.timeLeft = 0; step(extreme);
  assert.ok(Number.isFinite(extreme.mode.budget) && extreme.mode.reserve.length <= CFG.horde.fieldMax, 'overflow-sized waves still finish their tick with bounded storage');
}

// Horde over the server: lobby rules, the horde's seat, the host's early wave, and the record after the run.
{
  const map = { name: 'Horde fixture', w: 60, h: 60, rows: Array(60).fill('.'.repeat(60)), spawns: [{ x: 30, y: 5 }, { x: 10, y: 54 }, { x: 50, y: 54 }], defend: [0], points: [{ x: 30, y: 30 }] };
  const h = await serverHarness(), code = 'horde', { module } = await serverModule; h.useMap(JSON.stringify(map));
  let saved = null; const disk = { ...module.recordFile };
  Object.assign(module.recordFile, { read: () => '{}', write: (json) => { saved = JSON.parse(json); } });
  const host = await h.connect(code, { token: 'host', name: 'Host' }), room = h.rooms.get(code);
  await host.send({ t: 'army', v: 'endless' }); await host.send({ t: 'mode', v: 'horde' });
  await h.waitFor(() => host.lobby().mode === 'horde', 'horde lobby');
  assert.ok(room.army === 'standard' && host.lobby().hordeMaps.includes(room.mapName) && host.lobby().spawns === 5 && host.lobby().hordeBest === null, 'Horde lobby: a horde map, five seats, no Endless, no record yet');
  await host.send({ t: 'army', v: 'endless' });
  assert.equal(room.army, 'standard', 'Horde refuses Endless');
  await host.send({ t: 'start' });
  const start = await host.wait('start'), g = room.game;
  assert.deepEqual([start.names, start.teams], [['Host', 'Horde'], [0, 1]], 'the start message names the horde');
  await h.tick(2);
  assert.ok(!g.mode.active, 'the first break is running');
  await host.send({ t: 'nextwave' }); await h.tick(2);
  assert.ok(g.mode.active && g.mode.wave === 1 && h.snapshots(host).at(-1).mode.wave === 1, 'the host sends the wave early');
  g.units.get(g.mode.bunker).hp = 0;
  for (let i = 0; room.state !== 'lobby'; i++) { assert.ok(i < 400, 'the horde run returns to the lobby'); await h.tick(); }
  await h.waitFor(() => host.lobby().result?.horde, 'horde result');
  const r = host.lobby().result;
  assert.ok(r.horde.wave === 1 && r.horde.record && r.names.at(-1) === 'Horde' && r.you.outcome === 'defeat', 'the result carries the wave reached');
  assert.deepEqual([saved['default|1|standard'].wave, host.lobby().hordeBest.wave], [1, 1], 'the best run is saved per map, team size and army size, and shown in the lobby');
  Object.assign(module.recordFile, disk);
  await h.close();
}

// Roads and mud: vehicles drive faster along a road and crawl through mud; infantry do not care. Paths avoid mud.
{
  const rows = empty.map((row, y) => y >= 1 && y <= 3 ? 'D'.repeat(20) : row), g = fresh(rows), bog = fresh(Array(20).fill('M'.repeat(20))), deep = fresh(Array(20).fill('M'.repeat(20)));
  for (const p of [g, bog, deep].flatMap(q => q.players)) p.mp = 5000;
  bog.wear.fill(0); deep.wear.fill(1);
  const go = (type, z, q = g) => { const u = put(q, 0, type, 3, z); command(q, 0, { t: 'move', orders: [[u.id, 37, z]] }); return u; };
  const road = go('tank', 5), edge = go('tank', 8.2), grass = go('tank', 29), mud = go('tank', 29, bog), sunk = go('tank', 29, deep), feet = go('rifle', 13, bog), feetGrass = go('rifle', 13);
  run(g, 2); run(bog, 2); run(deep, 2);
  const ratio = (u) => (u.x - 3) / (grass.x - 3);
  assert.ok(Math.abs(ratio(road) - CFG.roadSpeed) < 0.1, 'a tank on a road drives roadSpeed times faster');
  assert.ok(ratio(edge) > 1.03 && ratio(edge) < CFG.roadSpeed - 0.1, 'a tank half on the road gets part of the bonus');
  assert.ok(Math.abs(ratio(mud) - CFG.mudSpeed[0]) < 0.1, 'a tank in shallow mud');
  assert.ok(Math.abs(ratio(sunk) - CFG.mudSpeed[1]) < 0.1, 'a tank in deep mud');
  assert.ok(Math.abs(feet.x - feetGrass.x) < 0.2, 'infantry walk through mud at full speed');
  // a mud band with one dry cell: the tank goes through the gap, the squad walks straight across
  const band = empty.map((row, y) => y >= 7 && y <= 13 ? row.slice(0, 10) + (y === 11 ? '.' : 'M') + row.slice(11) : row), b = fresh(band);
  b.chars.forEach((ch, c) => { if (ch === "M") b.wear[c] = 1; });
  const wet = (path) => path.some(p => b.chars[Math.floor(p.z / CELL) * b.w + Math.floor(p.x / CELL)] === 'M');
  const drive = findPath(b, { x: 5, z: 21, type: 'tank' }, { x: 35, z: 21 });
  assert.ok(drive.length > 1 && !wet(drive), 'a vehicle routes around mud when dry ground is near');
  assert.equal(findPath(b, { x: 5, z: 21, type: 'rifle' }, { x: 35, z: 21 }).length, 1, 'infantry walk straight through mud');
  // a road two cells to the side: the vehicle swings onto it and stays on it, the squad walks straight
  const onRoad = (path) => path.filter(p => Math.floor(p.z / CELL) >= 1 && Math.floor(p.z / CELL) <= 3).length;
  assert.ok(onRoad(findPath(g, { x: 3, z: 9, type: 'tank' }, { x: 37, z: 9 })) > 5, 'a vehicle takes the road beside it');
  assert.equal(onRoad(findPath(g, { x: 3, z: 9, type: 'rifle' }, { x: 37, z: 9 })), 0, 'infantry ignore the road');
}

// Bridges: a squad builds one across a river from the bank, and vehicles can then cross.
{
  const rows = empty.map(row => row.slice(0, 9) + 'WWW' + row.slice(12)), g = fresh(rows);
  g.players[0].mp = 1000;
  const crew = put(g, 0, 'rifle', 13, 21), mp = g.players[0].mp, from = { x: 5, z: 21, type: 'tank' }, to = { x: 35, z: 21 };
  assert.deepEqual(findPath(g, from, to), [], 'the river stops vehicles');
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'bridge', x: 5, z: 21, dir: 0 }), 'blocked', 'a bridge needs a river under it');
  assert.equal(command(g, 0, { t: 'dig', ids: [crew.id], kind: 'bridge', x: 21, z: 21, dir: 0 }), undefined, 'a bridge is ordered across the river');
  assert.equal(g.players[0].mp, mp - sim.FORTS.bridge.cost, 'the bridge is paid for');
  run(g, CFG.digTime * 3 + 1);
  assert.deepEqual([9, 10, 11].map(x => g.chars[10 * g.w + x]).join(''), '===', 'the span is built from the bank');
  assert.ok(crew.x < 18, 'the builders stay on their bank');
  assert.ok(findPath(g, from, to).length, 'vehicles cross the new bridge');
}

// Mines: hidden from the enemy, harmless to the side that laid them, and they go off under the first enemy.
{
  const g = fresh(); for (const p of g.players) p.mp = 5000;
  const sapper = put(g, 0, 'rifle', 21, 17);
  command(g, 0, { t: 'dig', ids: [sapper.id], kind: 'mines', x: 21, z: 21, dir: 0 });
  run(g, CFG.digTime * 4 + 1);
  const cells = [9, 10, 11, 12].map(x => 10 * g.w + x), laid = () => cells.filter(c => g.chars[c] === 'N').length;
  assert.equal(laid(), 4, 'four mines are laid');
  assert.equal(sim.terrainFor(g, 0, true).filter(([, ch]) => ch === 'N').length, 4, 'the side that laid them sees them');
  assert.equal(sim.terrainFor(g, 1, true).filter(([c]) => cells.includes(c)).length, 0, 'the enemy is told nothing');
  const friend = put(g, 0, 'tank', 21, 13); command(g, 0, { t: 'move', orders: [[friend.id, 21, 29]] });
  run(g, 4);
  assert.equal(laid(), 4, 'friendly vehicles drive over them');
  g.units.delete(friend.id); g.units.delete(sapper.id); // nobody for the enemy tank to shell: a stray shell would clear mines
  const foe = put(g, 1, 'tank', 23, 13), hp = foe.hp; command(g, 1, { t: 'move', orders: [[foe.id, 23, 29]] });
  run(g, 4);
  assert.equal(laid(), 3, 'one mine goes off under the enemy tank');
  assert.ok(hp - foe.hp >= CFG.mine.veh * 0.5, 'it hurts the tank (at least half the mine damage, by distance from the cell)');
  assert.equal(g.chars[10 * g.w + 11], '+', 'and leaves a crater');
  assert.deepEqual(sim.terrainFor(g, 1, true).filter(([c]) => cells.includes(c)).map(([, ch]) => ch), ['+'], 'the enemy now sees the crater, not the other mines');
  // an explosion clears the mines it reaches
  command(g, 1, { t: 'support', kind: 'dive', x: 21, z: 21 }); run(g, 8);
  assert.equal(laid(), 0, 'a bomb clears the mines');
}

// Ground that wears: traffic churns open ground into mud, shelling breaks a road into craters, and clients hear of it.
{
  const g = fresh(); g.players[0].mp = 5000;
  const row = 10 * g.w, state = (q, c) => sim.terrainFor(q, 0, true).find(([k]) => k === c)?.[3] ?? 0;
  const tank = put(g, 0, 'tank', 3, 21), slow = fresh(); slow.players[0].mp = 5000; slow.wear.fill(0.5);
  const worn = put(slow, 0, 'tank', 3, 29), ref = put(g, 0, 'tank', 3, 29);
  for (const [q, u] of [[slow, worn], [g, ref]]) command(q, 0, { t: 'move', orders: [[u.id, 37, 29]] });
  run(g, 2); run(slow, 2);
  assert.ok(Math.abs((worn.x - 3) / (ref.x - 3) - (1 - CFG.churn * 0.5)) < 0.06, 'half-churned ground costs half the churn');
  assert.ok(g.wear[14 * g.w + 3] > 0 && g.wear[14 * g.w + 3] < 0.2, 'one pass leaves a little wear');
  g.wear.fill(0.24, row, row + g.w);
  command(g, 0, { t: 'move', orders: [[tank.id, 37, 21]] }); run(g, 8);
  assert.equal(state(g, row + 5) & 3, 1, 'the wear step reaches the clients');
  g.wear.fill(0.99, row, row + g.w);
  command(g, 0, { t: 'move', orders: [[tank.id, 3, 21]] }); run(g, 10);
  assert.equal(g.chars[row + 8], 'M', 'ground driven on enough turns to mud');
  assert.ok(g.wear[row + 8] < 0.2, 'shallow mud at first');
  assert.equal(sim.terrainFor(g, 0, true).find(([k]) => k === row + 8)[1], 'M', 'and the clients are told');

  const road = fresh(empty.map((r, y) => y === 10 ? 'D'.repeat(20) : r)); road.players[1].mp = 5000;
  command(road, 1, { t: 'support', kind: 'dive', x: 21, z: 21 }); run(road, 8);
  assert.equal(road.chars[row + 10], '+', 'a bomb turns the road under it into a crater');
  assert.ok(road.chars[row + 14] === 'D' && road.wear[row + 14] === 0, 'and leaves the road out of its reach alone');
  assert.equal(findPath(road, { x: 3, z: 21, type: 'tank' }, { x: 37, z: 21 }).length > 0, true);

  // depth: fords and mud differ from cell to cell, and the client can work out a map cell's first state
  const wet = fresh(empty.map((r, y) => y === 10 ? 'F'.repeat(20) : r));
  const depths = [...wet.wear.slice(row, row + g.w)];
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.2 && depths.every(d => d >= 0.2 && d <= 0.8), 'ford cells have their own depth');
  assert.equal(sim.startState('F', row + 3), Math.min(3, Math.floor(wet.wear[row + 3] * 4)), 'startState gives a map cell its first state');
}

// Cover fades with distance and with damage; a shot-up wall tells the clients its stage.
{
  const rows = empty.map((r, y) => y === 10 ? r.slice(0, 10) + '#' + r.slice(11) : r), g = fresh(rows), c = 10 * g.w + 10, from = { x: 39, z: 21 };
  const at = (d) => sim.coverBehind(g, { x: 20 - d, z: 21 }, from);
  assert.equal(at(1), 1, 'full cover right behind the wall');
  assert.ok(at(2.6) > 0.1 && at(2.6) < 0.9, 'partial cover a few steps back');
  assert.equal(at(5), 0, 'none further away');
  assert.equal(sim.coverBehind(g, { x: 23, z: 21 }, from), 0, 'none on the shooter\u2019s side');
  g.players[0].mp = 5000;
  const tank = put(g, 0, 'tank', 21, 35); command(g, 0, { t: 'fireat', ids: [tank.id], x: 21, z: 21 });
  let stage = 0;
  for (let i = 0; i < 20 * 30 && g.chars[c] === '#'; i++) { step(g); stage = Math.max(stage, (sim.terrainFor(g, 0, true).find(([k]) => k === c)?.[3] ?? 0) >> 3); if (stage && at(1) === 1) assert.fail('a damaged wall still gives full cover'); }
  assert.ok(stage >= 1, 'the wall passes through a damaged stage before it falls');
}

// Slope: going uphill is slower in proportion to the grade.
{
  const heights = empty.map(() => '0'.repeat(10) + '1'.repeat(10)), hill = createGame({ ...blank(empty), heights }, ['a', 'b'], false), flat = fresh();
  hill.units.clear(); hill.players.forEach(p => (p.spawn = { x: -1000, z: -1000 }));
  hill.players[0].mp = flat.players[0].mp = 5000;
  const up = put(hill, 0, 'tank', 15, 21), level = put(flat, 0, 'tank', 15, 21), down = put(hill, 0, 'tank', 25, 29), back = put(flat, 0, 'tank', 25, 29);
  command(hill, 0, { t: 'move', orders: [[up.id, 25, 21], [down.id, 15, 29]] }); command(flat, 0, { t: 'move', orders: [[level.id, 25, 21], [back.id, 15, 29]] });
  run(hill, 1.2); run(flat, 1.2);
  assert.ok(up.x < level.x - 0.5, 'a tank climbs slower than it drives on the flat');
  assert.ok(Math.abs(down.x - back.x) < 0.3, 'and loses nothing going down');
}

// Wind, weather, dust and fire.
{
  const g = fresh(); g.players[0].mp = 5000;
  g.wind = { a: 0, v: 1 }; g.smokes.push({ x: 10, z: 10, r: 5, t: 60 });
  run(g, 5);
  assert.ok(g.smokes[0].x > 14 && Math.abs(g.smokes[0].z - 10) < 2, 'smoke drifts downwind');
  // rain: comes on, soaks the ground, slows vehicles off the road and shortens sight
  const tank = put(g, 0, 'tank', 3, 21); command(g, 0, { t: 'move', orders: [[tank.id, 37, 21]] }); run(g, 1);
  const dry = tank.x - 3, flags = (q, u) => snapshotFor(q, 0, []).units.find(r => r[0] === u.id)[12];
  assert.ok(flags(g, tank) & 32768, 'a tank moving on dry ground trails dust');
  g.wx.next = 0; run(g, 40);
  assert.equal(g.wx.rain, 1, 'the rain sets in');
  assert.ok(g.wx.wet > 0.15 && g.wx.wet < 0.5, 'and the ground soaks slowly');
  assert.deepEqual(snapshotFor(g, 0, []).wx.slice(0, 1), [1], 'clients are told the weather');
  g.wx.wet = 1; g.wx.next = 1e9; Object.assign(tank, { x: 3, z: 25, path: [] });
  command(g, 0, { t: 'move', orders: [[tank.id, 37, 25]] }); run(g, 1);
  assert.ok(Math.abs((tank.x - 3) / dry - (1 - CFG.weather.wetGround)) < 0.06, 'wet ground slows a tank');
  assert.ok(!(flags(g, tank) & 32768), 'no dust in the wet');
  assert.equal(createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { weather: false }).wx, null, 'weather can be switched off');

  // fire: runs down a hedge before the wind, leaves it burnt, hurts infantry, and rain smothers it
  const rows = empty.map((r, y) => y === 10 ? '..' + 'H'.repeat(14) + '....' : r), f = fresh(rows), row = 10 * f.w;
  f.players[0].mp = 5000; f.wind = { a: 0, v: 1 }; f.wx = null;
  f.fires.set(row + 2, CFG.fire.burn.H);
  assert.deepEqual(snapshotFor(f, 0, []).fires, [row + 2], 'clients are told what burns');
  const squad = put(f, 0, 'rifle', 7, 21), hp = squad.hp; f.fires.set(row + 3, CFG.fire.burn.H);
  run(f, 3);
  assert.ok(squad.hp < hp, 'infantry in the fire are hurt');
  assert.ok(Math.floor(squad.z / CELL) !== 10 && squad.hp > 0, 'and an idle squad steps out of the hedge');
  run(f, 120);
  assert.equal(f.fires.size, 0, 'the fire burns out');
  const gone = [...f.chars.slice(row + 2, row + 16)].filter(ch => ch !== 'H').length;
  assert.ok(gone >= 12, `the fire ran down the hedge (${gone} of 14 cells)`);
  assert.ok(f.burnt[row + 2] && (sim.terrainFor(f, 0, true).find(([k]) => k === row + 2)[3] & 4), 'burnt ground is marked for the clients');
  const wetRows = fresh(rows); wetRows.wx.rain = 1; wetRows.wx.raining = true; wetRows.wx.next = 1e9;
  wetRows.fires.set(row + 2, CFG.fire.burn.H); run(wetRows, 5);
  assert.equal(wetRows.fires.size, 0, 'rain puts a fire out before it spreads');
  assert.equal([...wetRows.chars.slice(row + 3, row + 16)].filter(ch => ch !== 'H').length, 0);
}

// Computer players lay mines in front of a point they hold and put a blown bridge back.
{
  const g = fresh(); g.players[0].mp = 5000; g.points[0].owner = 0; g.points[0].progress = 1;
  const holder = put(g, 0, 'rifle', g.points[0].x, g.points[0].z);
  for (let i = 0; i < 20 * 90; i++) { if (i % 40 === 0) think(g, 0); step(g); }
  const laid = g.mines.size;
  assert.ok(laid >= 3 && laid <= sim.FORTS.mines.n, 'the squad holding a point lays one minefield');
  assert.ok([...g.mines.values()].every(by => by === 0), 'the mines are its own');
  for (let i = 0; i < 20 * 30; i++) { if (i % 40 === 0) think(g, 0); step(g); }
  assert.equal(g.mines.size, laid, 'and does not keep laying more');
  assert.ok(holder.hp > 0);

  // a bomb hole beside the point it holds gets filled back in
  g.players[1].mp = 5000; command(g, 1, { t: 'support', kind: 'dive', x: 29, z: 21 });
  run(g, SUPPORT.dive.delay + 1);
  assert.ok(g.height.some(l => l === -2), 'a hole two levels deep');
  for (let i = 0; i < 20 * 300 && g.height.some(l => l < 0); i++) { if (i % 40 === 0) think(g, 0); step(g); }
  assert.ok(g.height.every(l => l >= 0), 'the computer player fills the hole in');
  assert.ok(holder.hp > 0);

  const rows = empty.map((row, y) => row.slice(0, 9) + (y === 10 ? '===' : 'WWW') + row.slice(12)), r = fresh(rows);
  r.players[0].mp = 5000; r.points = [];
  const sapper = put(r, 0, 'rifle', 5, 21), tank = { x: 5, z: 21, type: 'tank' };
  think(r, 0); // first look: the bridge is noted
  r.players[1].mp = 5000;
  assert.equal(command(r, 1, { t: 'support', kind: 'dive', x: 21, z: 21 }), undefined);
  for (let i = 0; i < 20 * 15 && r.chars[10 * r.w + 10] === '='; i++) step(r);
  assert.equal(r.chars[10 * r.w + 10], 'W', 'the bridge is blown');
  for (let i = 0; i < 20 * 60 && !findPath(r, tank, { x: 35, z: 21 }).length; i++) { if (i % 40 === 0) think(r, 0); step(r); }
  assert.ok(findPath(r, tank, { x: 35, z: 21 }).length, 'the computer player rebuilds the bridge');
  assert.ok(sapper.hp > 0);
}

// ---------- woods, mine clearing, halftracks, medics, the Field Hospital and supply lines ----------
{
  const open = (w = 40, h = 40) => Array(h).fill('.'.repeat(w));
  const put = (rows, x, y, s) => { rows[y] = rows[y].slice(0, x) + s + rows[y].slice(x + s.length); };
  const mapOf = (rows, extra = {}) => ({ name: 't', w: rows[0].length, h: rows.length, rows, spawns: [{ x: 2, y: 2 }, { x: rows[0].length - 3, y: rows.length - 3 }], points: [{ x: 20, y: 20 }], ...extra });
  const unitOf = (g, slot, type) => [...g.units.values()].find(u => u.owner === slot && u.type === type);
  const at = (x, y) => ({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  const place = (g, u, x, y) => { Object.assign(u, at(x, y), { path: [], autoRetreat: false }); return u; }; // shelled targets stay put
  const run = (g, n) => { for (let i = 0; i < n; i++) step(g); };
  const add = (g, slot, type, x, y) => { g.players[slot].mp += 2000; command(g, slot, { t: 'buy', unit: type }); const u = [...g.units.values()].filter(o => o.owner === slot && o.type === type).at(-1); return place(g, u, x, y); };

  // woods: sight reaches a few cells in, infantry get light cover, vehicles crawl and route around, fire clears them
  {
    const rows = open(); for (let y = 17; y < 24; y++) put(rows, 15, y, "OOOOOOOOOO");
    assert.equal(sim.validateMap(mapOf(rows)), null, 'a map with woods is valid');
    const g = createGame(mapOf(rows), ['a', 'b'], false, [0, 1], [0, 1], { weather: false });
    assert.ok(los(g, at(10, 20), at(17, 20)), 'a squad two cells inside the woods is seen from outside');
    assert.ok(!los(g, at(10, 20), at(22, 20)), 'a squad deep in the woods is hidden');
    assert.ok(!los(g, at(10, 20), at(30, 20)), 'nobody sees through a wood');
    assert.ok(los(g, at(10, 5), at(30, 5)), 'open ground beside the wood is clear');
    const rifle = place(g, unitOf(g, 0, 'rifle'), 16, 20);
    assert.ok(sim.inCover(g, rifle), 'infantry in the woods are in cover');
    const tank = add(g, 0, 'tank', 10, 20);
    const through = findPath(g, tank, at(30, 20));
    assert.ok(through.length && through.every(p => g.chars[Math.floor(p.z / CELL) * g.w + Math.floor(p.x / CELL)] !== 'O'), 'a tank drives around a wood');
    const inf = findPath(g, rifle, at(30, 20));
    assert.ok(inf.length <= 2, 'infantry walk straight through');
    assert.equal(command(g, 0, { t: 'dig', ids: [rifle.id], kind: 'trench', x: at(18, 20).x, z: at(18, 20).z }), 'blocked', 'no trench among the trees');
  }

  // mines: builder squads find them, the team's routes go around them and Clear mines lifts them
  {
    const g = createGame(mapOf(open()), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    const layer = place(g, unitOf(g, 1, 'rifle'), 20, 22), sweeper = place(g, unitOf(g, 0, 'rifle'), 20, 5);
    g.players[1].mp = 1000;
    assert.equal(command(g, 1, { t: 'dig', ids: [layer.id], kind: 'mines', x: at(20, 20).x, z: at(20, 20).z, dir: 0 }), undefined);
    run(g, 300);
    const mines = [...g.mines.keys()];
    assert.equal(mines.length, 4, 'four mines laid');
    place(g, layer, 38, 38); place(g, sweeper, 20, 18);
    const hidden = () => snapshotFor(g, 0, []).cells.filter(c => c[1] === 'N').length;
    assert.equal(sim.terrainFor(g, 0, true).filter(c => c[1] === 'N').length, 0, 'enemy mines start hidden');
    assert.equal(command(g, 0, { t: 'dig', ids: [sweeper.id], kind: 'demine', x: at(20, 20).x, z: at(20, 20).z, dir: 0 }), 'blocked', 'unknown mines cannot be cleared (and the answer does not give them away)');
    run(g, 60);
    assert.equal(sim.terrainFor(g, 0, true).filter(c => c[1] === 'N').length, 4, 'a builder squad standing near finds them');
    assert.ok(mines.every(c => sim.mineKnown(g, c, 0)), 'the team knows them');
    const route = findPath(g, sweeper, at(20, 24));
    const crosses = (a, b) => { for (let k = 0; k <= 200; k++) { const c = Math.floor((a.z + (b.z - a.z) * k / 200) / CELL) * g.w + Math.floor((a.x + (b.x - a.x) * k / 200) / CELL); if (g.chars[c] === 'N') return true; } return false; };
    assert.ok(![sweeper, ...route].some((p, i, l) => l[i + 1] && crosses(p, l[i + 1])), 'the route goes around known mines');
    g.players[0].mp = 1000;
    assert.equal(command(g, 0, { t: 'entrench', ids: [sweeper.id], pattern: 'line', fort: 'demine', x: at(19, 20).x, z: at(19, 20).z, x2: at(22, 20).x, z2: at(22, 20).z }), undefined, 'Clear mines is ordered as a line');
    run(g, 600);
    assert.equal(g.mines.size, 0, 'the mines are lifted');
    assert.ok(sweeper.hp === UNITS.rifle.models * UNITS.rifle.hpPer, 'and nobody stepped on one');
  }

  // halftrack: a squad boards, rides hidden and unhurt, gets out on Unload, and is thrown out when it is wrecked
  {
    const g = createGame(mapOf(open()), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    const ht = add(g, 0, 'halftrack', 10, 10), rifle = place(g, unitOf(g, 0, 'rifle'), 13, 10), mg = place(g, unitOf(g, 0, 'mg'), 13, 12);
    assert.equal(command(g, 0, { t: 'board', ids: [rifle.id, mg.id], target: ht.id }), undefined);
    run(g, 100);
    assert.equal(rifle.riding, ht.id, 'the nearest squad is in'); assert.equal(ht.cargo, rifle.id); assert.equal(mg.riding, 0, 'one squad only');
    assert.equal(command(g, 0, { t: 'board', ids: [mg.id], target: ht.id }), 'max', 'a full carrier takes nobody');
    command(g, 0, { t: 'move', orders: [[ht.id, at(30, 10).x, at(30, 10).z], [rifle.id, 0, 0]] });
    run(g, 200);
    assert.ok(Math.hypot(rifle.x - ht.x, rifle.z - ht.z) < 0.01 && ht.x > at(25, 10).x, 'the squad rides along and ignores its own orders');
    assert.ok(snapshotFor(g, 0, []).units.find(u => u[0] === rifle.id)[12] & sim.RIDING_FLAG, 'its owner is told it is riding');
    const foe = place(g, unitOf(g, 1, 'rifle'), 32, 10);
    run(g, 10);
    assert.ok(g.players[1].visible.has(ht.id) && !g.players[1].visible.has(rifle.id), 'the enemy sees the halftrack, not the squad in it');
    place(g, foe, 38, 38);
    assert.equal(command(g, 0, { t: 'unload', ids: [ht.id] }), undefined);
    assert.equal(rifle.riding, 0); assert.equal(ht.cargo, 0);
    assert.equal(command(g, 0, { t: 'board', ids: [rifle.id], target: ht.id }), undefined);
    run(g, 100);
    assert.equal(rifle.riding, ht.id);
    ht.hp = 0; run(g, 3);
    assert.equal(rifle.riding, 0, 'thrown out of the wreck');
    assert.ok(Math.abs(rifle.hp - UNITS.rifle.models * UNITS.rifle.hpPer * (1 - CFG.aid.evict)) < 1e-6, 'and hurt');
    // a halted halftrack reinforces infantry beside it, for manpower, slower than the HQ
    const ht2 = add(g, 0, 'halftrack', 5, 30); place(g, rifle, 6, 31); rifle.hp = 20; g.players[0].mp = 500;
    run(g, 200);
    assert.ok(rifle.hp > 20 && rifle.hp < 100 && g.players[0].mp < 500 + 200 * CFG.mpBase / 20, 'squad reinforced beside the halftrack, and paid for');
    assert.ok(ht2.hp > 0);
  }

  // landing craft: a Shipyard on the coast trains one onto the water, it carries a squad over a strait no one can
  // walk across and lands it in the surf, never in deep water, and a squad in a boat sunk far from land drowns
  {
    // west island x 0-9, a strait (open water, with surf off a western beach for rows 20+), east island x 30-39
    const rows = open().map((r, y) => '.'.repeat(10) + (y >= 20 ? 'FF' : 'WW') + 'W'.repeat(16) + 'FF' + '.'.repeat(10));
    const naval = mapOf(rows, { naval: true, spawns: [{ x: 2, y: 2 }, { x: 37, y: 37 }], points: [{ x: 35, y: 5 }] });
    assert.equal(sim.validateMap(naval), null, 'a naval map is valid');
    const g = createGame(naval, ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false, mode: 'classic' });
    const p = g.players[0], eng = unitOf(g, 0, 'engineer'), rifle = unitOf(g, 0, 'rifle');
    const cellAt = (u) => Math.floor(u.z / CELL) * g.w + Math.floor(u.x / CELL);
    p.mp = 2000; p.fuel = 500;
    assert.equal(command(g, 0, { t: 'build', ids: [eng.id], kind: 'shipyard', x: at(3, 14).x, z: at(3, 14).z }), 'coast', 'a Shipyard needs open water beside it');
    assert.ok(sim.placementCheck(g, { kind: 'shipyard', x: at(8, 25).x, z: at(8, 25).z }, () => true).ok, 'surf off a beach counts as water');
    assert.equal(command(g, 0, { t: 'build', ids: [eng.id], kind: 'shipyard', x: at(8, 7).x, z: at(8, 7).z }), undefined, 'and goes up on the shore');
    const yard = unitOf(g, 0, 'shipyard');
    run(g, 20 * 90);
    assert.ok(yard.built >= 1, 'the Shipyard is built');
    assert.equal(command(g, 0, { t: 'buy', unit: 'lcvp', from: yard.id }), undefined);
    run(g, 20 * (UNITS.lcvp.train + 1));
    const boat = unitOf(g, 0, 'lcvp');
    assert.ok(boat && 'WF'.includes(g.chars[cellAt(boat)]), 'the boat is launched onto the water');
    const shore = at(36, 30);
    assert.equal(findPath(g, rifle, shore).length, 0, 'nobody walks across the strait');
    assert.equal(command(g, 0, { t: 'board', ids: [rifle.id], target: boat.id }), undefined);
    run(g, 20 * 20);
    assert.equal(rifle.riding, boat.id, 'the squad boards from the shore');
    command(g, 0, { t: 'move', orders: [[boat.id, at(20, 25).x, at(20, 25).z]] });
    run(g, 20 * 12);
    assert.ok(findPath(g, boat, at(20, 5)).length > 0 && 'WF'.includes(g.chars[cellAt(boat)]), 'the boat keeps to the water');
    assert.equal(command(g, 0, { t: 'unload', ids: [boat.id] }), 'shore', 'no landing in the middle of the strait');
    command(g, 0, { t: 'move', orders: [[boat.id, shore.x, shore.z]] });
    run(g, 20 * 15);
    assert.ok(boat.x > at(26, 0).x, 'the boat crosses to the far beach');
    assert.equal(command(g, 0, { t: 'unload', ids: [boat.id] }), undefined);
    assert.ok(rifle.riding === 0 && rifle.x > at(27, 0).x && !(g.flags[cellAt(rifle)] & sim.MOVE), 'the squad lands on the far side');
    // sunk in the middle of the strait with a squad aboard: the squad goes down with it
    place(g, eng, 9, 12);
    command(g, 0, { t: 'move', orders: [[boat.id, at(11, 12).x, at(11, 12).z]] });
    run(g, 20 * 15);
    assert.equal(command(g, 0, { t: 'board', ids: [eng.id], target: boat.id }), undefined);
    run(g, 20 * 10);
    assert.equal(eng.riding, boat.id);
    command(g, 0, { t: 'move', orders: [[boat.id, at(20, 8).x, at(20, 8).z]] });
    run(g, 20 * 10);
    boat.hp = 0; run(g, 3);
    assert.ok(!g.units.has(eng.id), 'a squad thrown out in deep water drowns');
    // a map that does not ask for boats takes no Shipyard
    const dry = createGame(mapOf(rows, { spawns: [{ x: 2, y: 2 }, { x: 37, y: 37 }], points: [{ x: 35, y: 5 }] }), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false, mode: 'classic' });
    dry.players[0].mp = 2000;
    assert.equal(command(dry, 0, { t: 'build', ids: [unitOf(dry, 0, 'engineer').id], kind: 'shipyard', x: at(8, 7).x, z: at(8, 7).z }), 'blocked', 'no Shipyard on a map without naval: true');
  }

  // warships: a destroyer keeps to deep water, shells what its side spots beyond its own sight, is hit along its whole
  // hull, and a gunboat's torpedo hits it hard
  {
    const rows = Array(40).fill('.'.repeat(10) + 'W'.repeat(70) + '.'.repeat(10)); // a 140 m sea between two coasts
    const g = createGame(mapOf(rows, { naval: true, spawns: [{ x: 3, y: 3 }, { x: 86, y: 36 }], points: [{ x: 5, y: 20 }] }), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false, mode: 'classic' });
    const p = g.players[0], eng = unitOf(g, 0, 'engineer');
    p.mp = 5000; p.fuel = 2000; p.mun = 500;
    assert.equal(command(g, 0, { t: 'build', ids: [eng.id], kind: 'shipyard', x: at(7, 12).x, z: at(7, 12).z }), undefined);
    run(g, 20 * 90);
    const yard = unitOf(g, 0, 'shipyard');
    assert.equal(command(g, 0, { t: 'buy', unit: 'destroyer', from: yard.id }), undefined);
    assert.equal(command(g, 0, { t: 'buy', unit: 'gunboat', from: yard.id }), undefined);
    run(g, 20 * (UNITS.destroyer.train + UNITS.gunboat.train + 2));
    const dd = unitOf(g, 0, 'destroyer'), cellAt = (u) => Math.floor(u.z / CELL) * g.w + Math.floor(u.x / CELL);
    assert.ok(dd && !(g.flags[cellAt(dd)] & (sim.LAND | sim.SHOAL)), 'the destroyer launches into deep water');
    command(g, 0, { t: 'move', orders: [[dd.id, at(12, 20).x, at(12, 20).z]] });
    run(g, 20 * 20);
    assert.ok(dd.x >= at(20, 0).x - 0.01, 'and stops short of the shoals instead of running aground');
    // a spotter on the far shore: the destroyer shells a squad 100 m off, well past its own 60 m sight
    command(g, 0, { t: 'move', orders: [[dd.id, at(40, 20).x, at(40, 20).z]] });
    run(g, 20 * 15);
    const foe = unitOf(g, 1, 'rifle'), spotter = unitOf(g, 0, 'rifle');
    place(g, foe, 85, 20); place(g, spotter, 82, 21); spotter.holdFire = true; foe.holdFire = true;
    const full = foe.hp;
    run(g, 20 * 20);
    assert.ok(Math.hypot(foe.x - dd.x, foe.z - dd.z) > UNITS.destroyer.vision && foe.hp < full, 'shore bombardment on a spotted target');
    // an enemy gunboat off the bow, beyond its own range of the ship's middle, still reaches the hull
    const boat = unitOf(g, 0, 'gunboat');
    boat.owner = 1; dd.rot = 0; dd.path = [];
    place(g, boat, 40 + Math.round((UNITS.destroyer.hull + 10) / CELL), 20); boat.holdFire = false;
    assert.ok(Math.hypot(boat.x - dd.x, boat.z - dd.z) > UNITS.gunboat.w.range, 'the gunboat is out of range of the middle');
    const before = dd.hp;
    g.players[1].mun = 100;
    assert.equal(command(g, 1, { t: 'ability', ids: [boat.id] }), undefined, 'torpedo loaded');
    run(g, 20 * 3);
    assert.ok(before - dd.hp >= UNITS.gunboat.w.veh * UNITS.gunboat.ab.mult * 0.99, 'the torpedo hits the hull hard');
  }

  // outside Classic, boats are bought like any unit on a naval map and launch on the water nearest the HQ
  {
    const rows = Array(40).fill('.'.repeat(10) + 'W'.repeat(70) + '.'.repeat(10));
    const extra = { spawns: [{ x: 3, y: 20 }, { x: 86, y: 20 }], points: [{ x: 5, y: 5 }] };
    const g = createGame(mapOf(rows, { naval: true, ...extra }), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    g.players[0].mp = 5000;
    assert.equal(command(g, 0, { t: 'buy', unit: 'destroyer' }), undefined, 'Conquest buys a destroyer on a naval map');
    const dd = unitOf(g, 0, 'destroyer'), c = Math.floor(dd.z / CELL) * g.w + Math.floor(dd.x / CELL);
    assert.ok(!(g.flags[c] & (sim.LAND | sim.SHOAL)), 'launched in deep water');
    const dry = createGame(mapOf(rows, extra), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    dry.players[0].mp = 5000;
    assert.equal(command(dry, 0, { t: 'buy', unit: 'gunboat' }), 'needs', 'but no boats where the map has no sea');
  }

  // medic: heals the most hurt squad nearby for free, but not one under fire
  {
    const g = createGame(mapOf(open()), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    const medic = add(g, 0, 'medic', 5, 30), rifle = place(g, unitOf(g, 0, 'rifle'), 6, 30), mp = () => g.players[0].mp;
    rifle.hp = 40; step(g);
    const before = mp();
    run(g, 200);
    assert.ok(rifle.hp > 40 + CFG.aid.heal * 8, 'the medic heals the squad');
    assert.ok(Math.abs(mp() - before - 200 * g.players[0].inc / 20) < 1, 'for free');
    rifle.hp = 40; run(g, 10); rifle.hp = 30; run(g, 20);
    assert.ok(rifle.hp > 30 && rifle.hp <= 30 + CFG.aid.heal * CFG.aid.hot + 0.01, `a squad under fire heals at half rate (${rifle.hp})`);
    assert.equal(command(g, 0, { t: 'attack', ids: [medic.id], target: unitOf(g, 1, 'rifle').id }), 'unseen');
    // an idle medic walks over to a hurt squad within reach, and heals it
    place(g, rifle, 15, 30); rifle.hp = 40; place(g, medic, 5, 30); run(g, 20 * 20);
    assert.ok(Math.hypot(medic.x - rifle.x, medic.z - rifle.z) <= CFG.aid.medic && rifle.hp > 60, `the medic went to the wounded (${rifle.hp} hp)`);
  }

  // Field Hospital: one per player, infantry near it reinforce
  {
    const g = createGame(mapOf(open()), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    const rifle = place(g, unitOf(g, 0, 'rifle'), 5, 30), mg = place(g, unitOf(g, 0, 'mg'), 7, 30);
    g.players[0].mp = 1000;
    assert.equal(command(g, 0, { t: 'dig', ids: [rifle.id], kind: 'aid', x: at(5, 31).x, z: at(5, 31).z, dir: 0 }), undefined);
    assert.equal(command(g, 0, { t: 'dig', ids: [rifle.id], kind: 'aid', x: at(10, 31).x, z: at(10, 31).z, dir: 0 }), 'max', 'one going up is the limit');
    run(g, 20 * 14);
    assert.equal(g.aid.size, 1, 'the hospital stands'); assert.equal(g.chars[31 * g.w + 5], 'A');
    assert.equal(command(g, 0, { t: 'dig', ids: [rifle.id], kind: 'aid', x: at(10, 31).x, z: at(10, 31).z, dir: 0 }), 'max', 'one per player');
    mg.hp = 25; run(g, 200);
    assert.ok(mg.hp > 25, 'infantry reinforce at the hospital');
    const foe = place(g, unitOf(g, 1, 'rifle'), 6, 32); foe.hp = 20; foe.holdFire = true; rifle.holdFire = mg.holdFire = true; const was = foe.hp;
    run(g, 100);
    assert.ok(foe.hp <= was, 'the enemy gets nothing from it');
  }

  // supply lines: a point across a river pays while a bridge stands and an enemy does not sit on the road
  {
    const rows = open(); for (let y = 0; y < 40; y++) put(rows, 12, y, 'WWW'); put(rows, 12, 20, '===');
    const g = createGame(mapOf(rows), ['a', 'b'], false, [0, 1], [0, 1], { weather: false });
    const p = g.points[0];
    p.owner = 0; p.progress = 1;
    for (const u of g.units.values()) if (u.owner === 1) place(g, u, 37, 37);
    run(g, 45);
    assert.equal(p.cut, false, 'a bridge keeps the point supplied');
    assert.equal(snapshotFor(g, 0, []).points[0][4], 0);
    const inc = g.players[0].inc;
    const foe = place(g, unitOf(g, 1, 'rifle'), 13, 20); foe.holdFire = true;
    for (const u of g.units.values()) if (u.owner === 0) { place(g, u, 3, 3); u.holdFire = true; }
    run(g, 45);
    assert.equal(p.cut, true, 'an enemy squad on the bridge cuts it');
    assert.ok(g.players[0].inc < inc, 'a cut point pays no manpower');
    assert.equal(snapshotFor(g, 0, []).points[0][4], 1, 'and the snapshot says so');
    const vp = g.players[0].vp; run(g, 20);
    assert.equal(g.players[0].vp, vp, 'nor victory points');
    place(g, foe, 20, 21); run(g, 45);
    assert.equal(p.cut, false, 'an enemy fighting for the point itself does not cut it');
    place(g, foe, 37, 37);
    for (const c of [20 * 40 + 12, 20 * 40 + 13, 20 * 40 + 14]) { g.chars[c] = 'W'; g.flags[c] = sim.TERRAIN.W; }
    run(g, 45);
    assert.equal(p.cut, true, 'a blown bridge cuts it');
    const h = createGame(mapOf(rows), ['a', 'b'], false, [0, 1], [0, 1], { weather: false, supply: false });
    h.points[0].owner = 0; for (const c of [20 * 40 + 12, 20 * 40 + 13, 20 * 40 + 14]) { h.chars[c] = 'W'; h.flags[c] = sim.TERRAIN.W; }
    run(h, 45);
    assert.equal(h.points[0].cut, false, 'supply: false turns the rule off');
  }

  // a house that falls spills rubble into the street: vehicles stop, the point is cut, a shovel opens the road again
  {
    const rows = open(); for (let y = 0; y < 40; y++) put(rows, 12, y, 'WWW');
    put(rows, 12, 19, 'BBB'); put(rows, 12, 20, 'DDD'); put(rows, 12, 21, 'WWW');
    const g = createGame(mapOf(rows), ['a', 'b'], false, [0, 1], [0, 1], { weather: false });
    const p = g.points[0], road = 20 * 40 + 13, spill = sim.CFG.rubbleSpill;
    p.owner = 0; p.progress = 1;
    for (const u of g.units.values()) { place(g, u, u.owner ? 37 : 3, u.owner ? 37 : 3); u.holdFire = true; }
    run(g, 45);
    assert.equal(p.cut, false, 'the street over the river keeps the point supplied');
    sim.CFG.rubbleSpill = 1;
    sim.damageCells(g, [...g.units.values()], at(13, 19), 3, 2000);
    sim.CFG.rubbleSpill = spill;
    assert.equal(g.chars[road], 'R', 'the falling house throws rubble across the road');
    assert.ok(g.flags[road] & sim.VBLOCK, 'and rubble stops vehicles');
    run(g, 45);
    assert.equal(p.cut, true, 'a street choked with rubble cuts the point');
    g.players[0].mp = 1000;
    const eng = place(g, unitOf(g, 0, 'rifle'), 10, 20);
    assert.equal(command(g, 0, { t: 'dig', ids: [eng.id], kind: 'fill', x: at(13, 20).x, z: at(13, 20).z, dir: 0 }), undefined, 'rubble can be cleared');
    run(g, 60 * 20);
    assert.deepEqual([12, 13, 14].map(x => g.chars[20 * 40 + x]), ['D', 'D', 'D'], 'cleared rubble gives the road back');
    run(g, 45);
    assert.equal(p.cut, false, 'and the point is supplied again');
  }

  // computer players cope: a short match with every new unit on the field runs clean
  {
    const rows = open(60, 60); for (let y = 20; y < 40; y++) put(rows, 25, y, 'OOOOOOOO');
    const g = createGame(mapOf(rows, { points: [{ x: 30, y: 15 }, { x: 30, y: 45 }] }), ['a', 'b'], false, [0, 1], [0, 2], { weather: false });
    for (const s of [0, 1]) { add(g, s, 'halftrack', 5 + s * 48, 8 + s * 44); add(g, s, 'medic', 6 + s * 46, 8 + s * 44); }
    for (let i = 0; i < 2400; i++) { if (i % 40 === 0) { think(g, 0); think(g, 1); } step(g); }
    assert.ok(g.tick === 2400);
  }
}
console.log('all sim checks passed');

// Command feedback: exact denials, partial ability success, shared placement and
// the same per-player throttle used by the server, with a deterministic clock.
{
  const { placementCheck, popCap, teamSees } = await import('./shared/sim.js');
  const g = fresh();
  g.players[0].mp = 0;
  assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), 'mp');
  assert.equal(g.units.size, 0, 'denied purchase does not create a unit');
  g.players[0].mp = 10000;
  for (let i = 0; i < popCap(g); i++) assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), undefined);
  assert.equal(command(g, 0, { t: 'buy', unit: 'rifle' }), 'pop');
  g.players[0].sup.recon = 23;
  assert.equal(command(g, 0, { t: 'support', kind: 'recon', x: 10, z: 10 }), 'cooldown');
  g.players[1].mp = 10000;
  assert.equal(command(g, 1, { t: 'buy', unit: 'tiger' }), undefined);
  assert.equal(command(g, 1, { t: 'buy', unit: 'tiger' }), 'max');
  const a = [...g.units.values()].find(u => u.owner === 0), hidden = [...g.units.values()].find(u => u.owner === 1);
  g.players[0].visible.clear();
  const hiddenReason = command(g, 0, { t: 'attack', ids: [a.id], target: hidden.id });
  assert.equal(hiddenReason, 'unseen');
  assert.equal(command(g, 0, { t: 'attack', ids: [a.id], target: 999999 }), hiddenReason, 'missing and hidden targets are indistinguishable');
  assert.equal(a.attackId, 0, 'denied target does not change the order');
  a.cd = 10;
  assert.equal(command(g, 0, { t: 'ability', ids: [a.id], x: 10, z: 10 }), 'cooldown');
  const ready = [...g.units.values()].find(u => u.owner === 0 && u !== a);
  assert.equal(command(g, 0, { t: 'ability', ids: [a.id, ready.id], x: 10, z: 10 }), undefined, 'one ready squad accepts a mixed selection');
  assert.deepEqual(ready.nade, { x: 10, z: 10 });

  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const classic = createGame(map, ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const p = classic.players[0], own = [...classic.units.values()].filter(u => u.owner === 0);
  const eng = own.find(u => u.type === 'engineer'), hq = own.find(u => u.type === 'hq');
  p.mp = 10000;
  assert.equal(command(classic, 0, { t: 'buy', unit: 'mg' }), 'needs');
  assert.equal(command(classic, 0, { t: 'buy', unit: 'tank' }), 'fuel');
  assert.equal(command(classic, 0, { t: 'support', kind: 'recon', x: 10, z: 10 }), 'mun');
  assert.equal(command(classic, 0, { t: 'build', ids: [eng.id], kind: 'motorpool', x: eng.x, z: eng.z }), 'needs');
  assert.equal(command(classic, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: hq.x, z: hq.z }), 'blocked');
  assert.equal(command(classic, 0, { t: 'build', ids: [], kind: 'barracks', x: hq.x, z: hq.z }), 'noBuilders');
  eng.retreating = true;
  assert.equal(command(classic, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: hq.x, z: hq.z }), 'retreating');
  eng.retreating = false;
  hq.queue = Array(5).fill('rifle');
  assert.equal(command(classic, 0, { t: 'buy', unit: 'rifle' }), 'queueFull');
  classic.mode.suddenDeath = true;
  assert.equal(command(classic, 0, { t: 'buy', unit: 'rifle' }), 'suddenDeath');
  assert.equal(command(classic, 0, { t: 'build', ids: [eng.id], kind: 'barracks', x: eng.x, z: eng.z }), 'suddenDeath');

  const ground = fresh(); ground.nodes = []; ground.height = new Int8Array(ground.w * ground.h);
  const place = { kind: 'barracks', x: 21, z: 21 };
  const flat = placementCheck(ground, place, () => true);
  assert.equal(flat.ok, true, 'flat ground permits a building');
  ground.height[flat.cells[1]] = 1;
  assert.equal(placementCheck(ground, place, () => true).ok, true, 'one level of fall is levelled by the builders');
  ground.height[flat.cells[1]] = 2;
  assert.equal(placementCheck(ground, place, () => true).reason, 'blocked', 'a footprint across a cliff is rejected');
  assert.equal(placementCheck(ground, place, () => false).reason, 'notVisible', 'sight is checked before hidden ground');
  ground.height[flat.cells[1]] = 0;
  assert.equal(placementCheck(ground, place, at => at.x !== 19 || at.z !== 19).ok, true, 'a visible center permits an unseen corner');
  assert.equal(placementCheck(ground, { kind: 'trench', x: 21, z: 21, dir: 0 }, () => false).reason, 'notVisible', 'a fort on unseen ground is refused even when valid, so the answer says nothing about hidden terrain');
  const blockedFort = fresh(); blockedFort.chars.fill('W');
  const trench = { kind: 'trench', x: 21, z: 21, dir: 0 };
  assert.equal(placementCheck(blockedFort, trench, () => false).reason, 'notVisible', 'fog masks a rejected fort');
  assert.equal(placementCheck(blockedFort, trench, () => true).reason, 'blocked', 'a visible rejected fort reports blocked');
  ground.nodes = [{ c: 8 * ground.w + 8, x: 18, z: 18, depot: 0 }, { c: 8 * ground.w + 11, x: 24, z: 18, depot: 0 }];
  const depotClick = { kind: 'depot', x: 21, z: 18 }, depotSees = at => at.x >= 20;
  const hiddenFree = placementCheck(ground, depotClick, depotSees);
  assert.equal(hiddenFree.reason, 'notVisible', 'the nearest free node needs a visible center');
  ground.nodes[0].depot = 999;
  const hiddenOccupied = placementCheck(ground, depotClick, depotSees);
  assert.equal(hiddenOccupied.ok, true, 'a taken nearer node is skipped');
  assert.equal(placementCheck(ground, { kind: 'depot', x: 19, z: 18 }, depotSees).ok, true, 'the click itself needs no sight');
  const depotFog = fresh();
  depotFog.nodes = [{ c: 8 * depotFog.w + 8, x: 18, z: 18, depot: 999 }, { c: 8 * depotFog.w + 17, x: 36, z: 18, depot: 0 }];
  const takenClick = { kind: 'depot', x: 18, z: 18 }, freeClick = { kind: 'depot', x: 36, z: 18 };
  const hiddenTaken = placementCheck(depotFog, takenClick, () => false);
  const hiddenAvailable = placementCheck(depotFog, freeClick, () => false);
  assert.equal(hiddenTaken.reason, 'notVisible', 'a hidden taken node does not reveal its depot');
  assert.equal(hiddenAvailable.reason, hiddenTaken.reason, 'hidden taken and free nodes give the same denial');
  assert.equal(placementCheck(depotFog, takenClick, () => true).reason, 'blocked', 'a visible taken node reports blocked');
  for (const rejected of [{ kind: 'barracks', x: -10, z: -10 }, { kind: 'depot', x: 2, z: 2 }, { kind: 'barracks', x: NaN, z: Infinity }]) {
    const result = placementCheck(ground, rejected);
    assert.equal(result.ok, false);
    assert.ok(Number.isFinite(result.x) && Number.isFinite(result.z), 'every invalid placement has finite preview coordinates');
  }
  classic.mode.suddenDeath = false;
  const outside = { kind: 'barracks', x: classic.w * CELL - 8, z: classic.h * CELL - 8 };
  assert.equal(placementCheck(classic, outside, at => teamSees(classic, p.team, at)).reason, 'notVisible');
  assert.equal(command(classic, 0, { t: 'build', ids: [eng.id], ...outside }), 'notVisible', 'server uses the same visibility check as the preview');

  const fortGame = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const fortEngineer = [...fortGame.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  fortGame.players[0].mp = 10000;
  let unseenFort = null;
  for (let y = 2; y < fortGame.h - 2 && !unseenFort; y++) for (let x = 2; x < fortGame.w - 2; x++) {
    const at = { kind: 'trench', x: (x + 0.5) * CELL, z: (y + 0.5) * CELL, dir: 0 };
    if (!teamSees(fortGame, fortGame.players[0].team, at) && placementCheck(fortGame, at).ok) { unseenFort = at; break; }
  }
  assert.ok(unseenFort, 'the map has an unseen valid fort site');
  assert.equal(command(fortGame, 0, { t: 'dig', ids: [fortEngineer.id], ...unseenFort }), 'notVisible', 'dig refuses a valid fort in fog');
  fortGame.chars.fill('W');
  assert.equal(command(fortGame, 0, { t: 'dig', ids: [fortEngineer.id], ...unseenFort }), 'notVisible', 'a rejected fort in fog masks its terrain');
  assert.equal(command(fortGame, 0, { t: 'dig', ids: [fortEngineer.id], kind: 'trench', x: fortEngineer.x, z: fortEngineer.z, dir: 0 }), 'blocked', 'a rejected visible fort reports blocked');

  // the throttle through the shared server harness: refused orders come back as deny messages, at most four a second
  const h = await serverHarness(), code = 'denies';
  const ana = await h.connect(code, { token: code + 'a', name: 'Ana' }), ben = await h.connect(code, { token: code + 'b', name: 'Ben' });
  await ana.send({ t: 'start' }); await ana.wait('start'); await ben.wait('start');
  const live = h.game(code), denies = client => client.messages.filter(msg => msg.t === 'deny');
  live.players[0].mp = 0; live.players[1].mp = 0;
  h.clock.advance(100);
  for (let i = 0; i < 20; i++) await ana.send({ t: 'buy', unit: 'rifle' });
  assert.equal(denies(ana).length, 4, 'at most four denials per player in one second');
  assert.deepEqual(denies(ana)[0], { t: 'deny', cmd: 'buy', reason: 'mp' });
  await ben.send({ t: 'buy', unit: 'rifle' });
  assert.equal(denies(ben).length, 1, 'another player has a separate allowance');
  h.clock.advance(999); await ana.send({ t: 'buy', unit: 'rifle' });
  assert.equal(denies(ana).length, 4, 'burst allowance does not reset at a wall-clock boundary');
  h.clock.advance(1); await ana.send({ t: 'buy', unit: 'rifle' });
  assert.equal(denies(ana).length, 5, 'allowance returns after one full second');
  live.players[0].mp = 10000; await ana.send({ t: 'buy', unit: 'rifle' });
  const mine = [...live.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  await ana.send({ t: 'stop', ids: [mine.id] });
  assert.equal(denies(ana).length, 5, 'only a denial adds a reply');
  await h.close();
}
console.log('all command feedback checks passed');

// Queued aimed ability availability defers cooldown and munitions while keeping eligibility checks.
{
  const { availability } = await import('./client/availability.js');
  const g = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const u = [...g.units.values()].find(v => v.owner === 0 && v.type === 'rifle');
  const check = (action) => availability(snapshotFor(g, 0, []), CFG, { slot: 0, ids: [u.id], ...action });
  g.players[0].mun = 0; u.cd = 5;
  for (const type of ['rifle', 'mortar', 'ranger']) {
    u.type = type;
    const action = { t: 'ability', unit: type, queue: true };
    assert.equal(check(action).ok, true, `${type} can queue during cooldown without munitions`);
    assert.equal(check({ ...action, queue: false }).ok, false, 'an immediate ability still checks readiness');
    assert.equal(command(g, 0, { ...action, ids: [u.id], x: 20, z: 20 }), undefined, 'the server accepts the deferred ability');
    assert.equal(u.nade, null, 'queueing does not start the ability');
    u.retreating = true;
    assert.equal(check(action).reason, 'That squad is retreating'); u.retreating = false;
    assert.equal(check({ ...action, unit: 'tank' }).ok, false, 'queueing still requires the selected ability type');
  }
  u.type = 'mg';
  assert.equal(check({ t: 'ability', unit: 'mg', queue: true }).ok, false, 'instant abilities cannot defer cooldown');
  assert.equal(g.players[0].mun, 0, 'waiting abilities charge no munitions up front');
}

// Defeated players and spectators cannot use any command card, even with resources or stale own unit rows.
{
  const { availability, buyCount } = await import('./client/availability.js');
  for (const mode of ['classic', 'annihilation']) {
    const g = createGame(JSON.parse(readFileSync('maps/default.json', 'utf8')), ['a', 'b', 'c'], false, [0, 1, 2], [0, 1, 2], { mode });
    g.players[0].mp = 10000; g.players[0].mun = 1000; g.players[0].fuel = 1000;
    const active = snapshotFor(g, 0, []), defeated = { ...active, out: [true, false, false] };
    const buy = { t: 'buy', slot: 0, unit: 'rifle' };
    assert.equal(availability(active, CFG, buy).ok, true, `${mode}: active recruitment remains available`);
    for (const t of ['buy', 'support', 'build', 'dig', 'ability', 'move', 'rally']) {
      const action = { ...buy, t };
      assert.deepEqual(availability(defeated, CFG, action), { ok: false, reason: 'You are spectating' }, `${mode}: defeated ${t} disabled`);
      assert.equal(availability(active, CFG, { ...action, watching: true }).ok, false, 'a spectator cannot use the watched seat');
    }
    assert.equal(buyCount(defeated, CFG, buy, 5), 0, 'Shift recruitment buys no units after defeat');
  }
}

// Availability uses real snapshots and prices, including queued units and completed buildings.
{
  const { availability, buyCount, placementState, denySentence } = await import('./client/availability.js');
  const { createFeedback, setAvailability } = await import('./client/feedback.js');
  const { priceOf, popCap, placementCheck, teamSees } = await import('./shared/sim.js');
  const g = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1], { mode: 'classic' });
  const p = g.players[0], eng = [...g.units.values()].find(v => v.owner === 0 && v.type === 'engineer');
  const hq = [...g.units.values()].find(v => v.owner === 0 && v.type === 'hq');
  const check = (action) => availability(snapshotFor(g, 0, []), CFG, { slot: 0, ids: [eng.id], ...action });
  p.mp = 0;
  assert.deepEqual(check({ t: 'buy', unit: 'rifle' }), { ok: false, reason: `Needs ${priceOf(g, 'rifle').mp} MP` });
  p.mp = 10000;
  assert.deepEqual(check({ t: 'buy', unit: 'mg' }), { ok: false, reason: 'Needs a Barracks' });
  assert.deepEqual(check({ t: 'build', kind: 'motorpool' }), { ok: false, reason: 'Needs a Barracks' });
  assert.deepEqual(check({ t: 'buy', unit: 'tank' }), { ok: false, reason: `Needs ${priceOf(g, 'tank').fuel} fuel` });
  p.sup.artillery = 22.1;
  assert.deepEqual(check({ t: 'support', kind: 'artillery' }), { ok: false, reason: 'Cooldown 23 s' });
  p.sup.artillery = 0;
  assert.deepEqual(check({ t: 'support', kind: 'artillery' }), { ok: false, reason: `Needs ${SUPPORT.artillery.mun} munitions` });
  eng.retreating = true;
  assert.equal(check({ t: 'build', kind: 'barracks' }).reason, 'That squad is retreating');
  assert.equal(check({ t: 'dig', kind: 'trench' }).reason, 'That squad is retreating');
  assert.equal(check({ t: 'cover' }).reason, 'That squad is retreating');
  eng.retreating = false;
  assert.equal(check({ t: 'cover' }).ok, true);
  assert.equal(check({ t: 'entrench' }).ok, true, 'Engineers can entrench, and nothing is charged up front');
  assert.equal(check({ t: 'entrench', ids: [hq.id] }).reason, 'Select a builder squad');
  assert.equal(check({ t: 'stance' }).ok, true);
  assert.equal(check({ t: 'stance', ids: [hq.id] }).reason, 'Select a unit');
  assert.equal(check({ t: 'cover', ids: [hq.id] }).reason, 'Select an infantry squad');
  assert.equal(check({ t: 'build', kind: 'barracks' }).ok, true);
  hq.queue = Array(5).fill('rifle');
  assert.equal(check({ t: 'buy', unit: 'rifle' }).reason, 'The training queue is full');
  // A card on one selected building asks that building: the server refuses a full one instead of using another.
  {
    const second = { ...hq, id: g.nextId++, queue: [] };
    g.units.set(second.id, second);
    assert.equal(check({ t: 'buy', unit: 'rifle' }).ok, true, 'any building with room will do for an unaimed buy');
    assert.equal(check({ t: 'buy', unit: 'rifle', from: second.id }).ok, true);
    assert.equal(check({ t: 'buy', unit: 'rifle', from: hq.id }).reason, 'The training queue is full', 'the chosen building is full');
    assert.equal(command(g, 0, { t: 'buy', unit: 'rifle', from: hq.id }), 'queueFull', 'the server agrees');
    assert.equal(buyCount(snapshotFor(g, 0, []), CFG, { t: 'buy', unit: 'rifle', from: hq.id, slot: 0 }, 5), 0);
    g.units.delete(second.id);
  }
  hq.queue = Array(popCap(g) - [...g.units.values()].filter(v => v.owner === 0 && !UNITS[v.type].structure).length).fill('rifle');
  assert.equal(check({ t: 'buy', unit: 'rifle' }).reason, `Army at its limit (${popCap(g)}/${popCap(g)})`);
  hq.queue = [];
  g.mode.suddenDeath = true;
  assert.equal(check({ t: 'buy', unit: 'rifle' }).reason, 'Not during Sudden Death');
  assert.equal(check({ t: 'build', kind: 'barracks' }).reason, 'Not during Sudden Death');
  g.mode.suddenDeath = false;
  command(g, 0, { t: 'buy', unit: 'rifle' }); run(g, UNITS.rifle.train + 1);
  const rifle = [...g.units.values()].find(v => v.owner === 0 && v.type === 'rifle');
  rifle.cd = 3.2; p.mun = 100;
  assert.equal(check({ t: 'ability', unit: 'rifle', ids: [rifle.id] }).reason, 'Cooldown 4 s');
  rifle.cd = 0; p.mun = 0;
  assert.equal(check({ t: 'ability', unit: 'rifle', ids: [rifle.id] }).reason, 'Needs 15 munitions');
  p.mun = 100;
  assert.equal(check({ t: 'ability', unit: 'rifle', ids: [rifle.id] }).ok, true);
  rifle.type = 'mortar'; p.mun = 15;
  assert.equal(check({ t: 'ability', unit: 'mortar', ids: [rifle.id] }).ok, true, 'Mortar Barrage uses the mortar price');
  assert.equal(check({ t: 'ability', unit: 'rocket', ids: [rifle.id] }).ok, false, 'a mortar selection is not a rocket selection');
  rifle.type = 'rocket';
  assert.equal(check({ t: 'ability', unit: 'rocket', ids: [rifle.id] }).ok, true, 'the Rocket Barrage costs no munitions');
  rifle.type = 'rifle';
  // Shift+letter asks for as many as the limits allow: the server takes exactly that many and refuses the next one.
  {
    const count = (unit, from) => buyCount(snapshotFor(g, 0, []), CFG, { t: 'buy', unit, from, slot: 0 }, 5);
    p.mp = priceOf(g, 'rifle').mp * 3 + 1;
    assert.equal(count('rifle', hq.id), 3, 'manpower for three');
    for (let i = 0; i < 3; i++) assert.equal(command(g, 0, { t: 'buy', unit: 'rifle', from: hq.id }), undefined);
    assert.equal(command(g, 0, { t: 'buy', unit: 'rifle', from: hq.id }), 'mp');
    p.mp = 10000;
    assert.equal(count('rifle', hq.id), 2, 'the queue has two places left');
    assert.equal(count('mg'), 0, 'refused outright: no Barracks');
    hq.queue = [];
    const c = createGame(blank(empty), ['a', 'b'], false, [0, 1], [0, 1]), cp = c.players[0];
    cp.mp = 1e6;
    while (popOf(c, 0) < popCap(c) - 2) command(c, 0, { t: 'buy', unit: 'rifle' });
    const n = buyCount(snapshotFor(c, 0, []), CFG, { t: 'buy', unit: 'rifle', slot: 0 }, 5);
    assert.equal(n, 2, 'two places left under the army limit');
    for (let i = 0; i < n; i++) assert.equal(command(c, 0, { t: 'buy', unit: 'rifle' }), undefined);
    assert.equal(command(c, 0, { t: 'buy', unit: 'rifle' }), 'pop');
  }

  const snapshot = snapshotFor(g, 0, []), map = blank(empty);
  // Terrain after initial HQ footprints is the same terrain the client receives.
  const grid = Array.from({ length: g.h }, (_, y) => g.chars.slice(y * g.w, (y + 1) * g.w));
  const view = placementState(snapshot, map, grid, [0, 1]);
  const order = { kind: 'barracks', x: hq.x, z: hq.z };
  assert.equal(placementCheck(view.game, order, at => view.sees(0, at)).reason,
    placementCheck(g, order, at => teamSees(g, p.team, at)).reason, 'preview and server share blocked footprint and sight rules');

  const oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
  const pending = new Map(); let next = 0, sounds = 0;
  globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 2000); pending.set(++next, fn); return next; };
  globalThis.clearTimeout = (id) => pending.delete(id);
  try {
    const hint = { textContent: 'Click where to build' }, feedback = createFeedback(hint, () => sounds++);
    feedback.show(denySentence('blocked'));
    assert.equal(hint.textContent, 'That spot is blocked or uneven');
    feedback.show(denySentence('unseen'));
    assert.equal(pending.size, 1, 'a second denial replaces the timer');
    assert.equal(sounds, 2, 'each denial plays the error sound');
    [...pending.values()][0](); pending.clear();
    assert.equal(hint.textContent, 'Click where to build', 'armed placement prompt returns after two seconds');
    feedback.show(denySentence('notVisible')); feedback.reset(); hint.textContent = '';
    assert.equal(pending.size, 0, 'canceling placement clears pending feedback');
    const button = { disabled: true, title: 'Rifle Squad', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    setAvailability(button, { ok: false, reason: 'Needs 100 MP' });
    assert.equal(button.disabled, false, 'unavailable cards remain clickable');
    assert.equal(button.attrs['aria-disabled'], 'true');
    assert.equal(button.title, 'Needs 100 MP');
    setAvailability(button, { ok: true, reason: '' });
    assert.equal(button.title, 'Rifle Squad', 'affordable card restores its description');
    const hovered = { ...button, title: '', _baseTip: undefined, _tooltip: 'Mortar Team', _tipActive: true };
    setAvailability(hovered, { ok: true, reason: '' });
    assert.equal(hovered._tooltip, 'Mortar Team', 'hover before the first availability update preserves its description');
  } finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
}
console.log('all availability checks passed');

// Model toolkit (client/models/geom.js): closed shapes are watertight with outward faces and the volume they should
// have, sizes come out as asked, merge matches mergeParts and multiplies colors, mirrorZ doubles a half, markings lie
// flat without overlaps, and ao darkens toward the floor without touching its input.
{
  const THREE = await import('three');
  const G = await import('./client/models/geom.js');
  const { mergeParts } = await import('./client/unit-models.js');
  const tri = (P, I, i) => [0, 1, 2].map((k) => (I ? I.getX(i + k) : i + k));
  // signed volume; every edge used once each way; every corner normal on the outside of its face
  const solid = (g, label) => {
    const P = g.attributes.position, N = g.attributes.normal, I = g.index, n = I ? I.count : P.count, t = [0, 1, 2].map(() => new THREE.Vector3()), nn = new THREE.Vector3();
    const key = (i) => [P.getX(i), P.getY(i), P.getZ(i)].map((v) => Math.round(v * 1e4)).join(), edges = new Map();
    let vol = 0, inward = 0;
    for (let i = 0; i < n; i += 3) {
      const ids = tri(P, I, i);
      ids.forEach((id, k) => t[k].fromBufferAttribute(P, id));
      vol += t[0].dot(new THREE.Vector3().crossVectors(t[1], t[2])) / 6;
      const face = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
      if (face.lengthSq() < 1e-20) continue;
      for (const id of ids) if (face.dot(nn.fromBufferAttribute(N, id)) <= 0) inward++;
      const k = ids.map(key);
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3]; if (a !== b) { const id = a < b ? a + '|' + b : b + '|' + a; edges.set(id, (edges.get(id) || 0) + (a < b ? 1 : -1)); } }
    }
    assert.equal(inward, 0, `${label}: every face points outward`);
    assert.ok([...edges.values()].every((v) => v === 0), `${label}: watertight`);
    assert.ok(vol > 0, `${label}: encloses a positive volume`);
    return vol;
  };
  const size = (g) => { g.computeBoundingBox(); return g.boundingBox.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)); };
  const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} should be near ${b}`);
  // area of a flat geometry, and the set of its vertex colors
  const area = (g) => { const P = g.attributes.position, I = g.index, t = [0, 1, 2].map(() => new THREE.Vector3()); let s = 0; for (let i = 0; i < I.count; i += 3) { tri(P, I, i).forEach((id, k) => t[k].fromBufferAttribute(P, id)); s += new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).length() / 2; } return s; };
  const colorsOf = (g) => { const C = g.attributes.color, s = new Set(); for (let i = 0; i < C.count; i++) s.add([C.getX(i), C.getY(i), C.getZ(i)].map((v) => v.toFixed(4)).join()); return s; };
  const hex = (h) => new THREE.Color(h).toArray().map((v) => v.toFixed(4)).join();

  // rounded box: the size asked and close to the exact rounded volume
  const bb = G.bevelBox(1, 0.5, 2, 0.1, 4), [a, b, c, r] = [0.8, 0.3, 1.8, 0.1];
  assert.deepEqual(size(bb), [1, 0.5, 2], 'bevelBox: outer size');
  near(solid(bb, 'bevelBox'), a * b * c + 2 * r * (a * b + a * c + b * c) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3, 0.01, 'bevelBox volume');
  assert.deepEqual(size(G.chamferBox(1, 0.5, 2, 0.1)), [1, 0.5, 2], 'chamferBox: outer size');
  assert.ok(solid(G.chamferBox(1, 0.5, 2, 0.1), 'chamferBox') < 1, 'chamferBox: the corners are cut off');

  // loft: an elliptic cylinder holds about pi r^2 L, a hull with a pointed nose closes, polygon rings work flat
  near(solid(G.loft([{ x: 0, w: 1, h: 1 }, { x: 2, w: 1, h: 1 }], { segments: 32 }), 'loft cylinder'), 16 * Math.sin(Math.PI / 16) * 0.25 * 2, 1e-4, 'loft cylinder volume');
  const hull = G.loft([{ x: 0, w: 0, h: 0 }, { x: 0.5, w: 0.6, h: 0.4 }, { x: 2, w: 0.7, h: 0.5, p: 4 }, { x: 2.5, w: 0.3, h: 0.3, y: 0.1 }]);
  solid(hull, 'loft hull'); assert.deepEqual(size(hull), [2.5, 0.5, 0.7], 'loft: length, height and width from the rings');
  solid(G.loft([{ x: 0, pts: [[0.5, 0], [0.4, 0.3], [-0.4, 0.3], [-0.5, 0], [-0.4, -0.2], [0.4, -0.2]] }, { x: 1, pts: [[0.6, 0], [-0.6, 0], [0.5, -0.25]] }], { normals: 'flat' }), 'loft polygons');

  // lathe: either profile direction gives the same outward solid; the wrappers close up
  const up = solid(G.lathe([[0, 0], [0.5, 0], [0.5, 1], [0, 1]], 16), 'lathe'), down = solid(G.lathe([[0, 1], [0.5, 1], [0.5, 0], [0, 0]], 16), 'lathe reversed');
  near(up, down, 1e-9, 'lathe profile direction'); near(up, 8 * Math.sin(Math.PI / 8) * 0.25, 1e-4, 'lathe volume');
  const gun = G.barrel(2, 0.06, { brake: true });
  solid(gun, 'barrel with brake'); assert.equal(size(gun)[0], 2, 'barrel: breech to muzzle along +x');
  for (const kind of ['m1', 'stahlhelm', 'ssh40']) solid(G.helmet(kind), `helmet ${kind}`);
  solid(G.bomb(1, 0.12), 'bomb'); solid(G.spinner(0.4, 0.15), 'spinner'); solid(G.engine(0.5, 0.4), 'engine');

  // extruded profile: the outline stays on the points even with a bevel, centered on z = 0
  const side = G.extrudeProfile([[0, 0], [2, 0], [2.3, 0.4], [1.8, 0.7], [0, 0.6]], 0.2, 0.04);
  assert.deepEqual(size(side), [2.3, 0.7, 0.2], 'extrudeProfile: silhouette and depth');
  near(solid(side, 'extrudeProfile'), 1.385 * 0.2, 0.01, 'extrudeProfile volume');
  near(side.boundingBox.min.z, -0.1, 1e-6, 'extrudeProfile: centered on z');
  solid(G.extrudeProfile([[0, 0], [1, 0], [1, 1], [0, 1]], 0.2, 0.03, { holes: [[[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]] }), 'extrudeProfile with a hole');

  // tube: a straight octagonal tube holds 2 sqrt 2 r^2 L; curves, tapers and closed loops stay closed
  near(solid(G.tube([[0, 0, 0], [1, 0, 0]], 0.1), 'tube'), 2 * Math.SQRT2 * 0.01, 1e-6, 'tube volume');
  solid(G.tube([[0, 0, 0], [1, 0.5, 0], [2, 0, 0.5], [3, 1, 0]], (u) => 0.06 - 0.03 * u), 'tapered tube');
  solid(G.tube([[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]], 0.05, { closed: true }), 'closed tube');

  // wheels and tracks: sizes, closed, and both paints in the vertex colors
  const w = G.wheel(0.5, 0.3, { color: 0x59623d });
  assert.deepEqual(size(w), [1, 1, 0.3], 'wheel: diameter in xy, axle along z');
  solid(w, 'wheel'); solid(G.wheel(0.5, 0.2, { spokes: 10, tread: 12 }), 'spoked wheel');
  assert.ok(colorsOf(w).has(hex(0x2b2a26)) && colorsOf(w).has(hex(0x59623d)), 'wheel: tire and disc colors');
  const t = G.track(4, 0.45, 40, { wheels: 5, color: 0x3d3b35 }), ts = size(t);
  solid(t, 'track');
  assert.ok(ts[0] > 4 && ts[0] < 4.3 && ts[2] === 0.5, 'track: as long as asked plus the grousers, as wide as asked');
  assert.ok(colorsOf(t).has(hex(0x3d3b35)), 'track: link color');
  solid(G.roadWheels(5, 0.3, 0.7, 0.25), 'road wheels'); solid(G.sprocket(0.4, 10, 0.25), 'sprocket');

  // mirrorZ: twice the half, symmetric across z = 0, still outward
  const half = G.loft([{ x: 0, w: 0.4, h: 0.4, z: 0.4 }, { x: 1, w: 0.4, h: 0.4, z: 0.4 }]), both = G.mirrorZ(half);
  near(solid(both, 'mirrorZ'), 2 * solid(half, 'half'), 1e-6, 'mirrorZ volume');
  both.computeBoundingBox(); near(both.boundingBox.min.z, -both.boundingBox.max.z, 1e-6, 'mirrorZ: symmetric');

  // merge matches mergeParts, and both multiply a part's paint with the shape's own colors
  const parts = [{ geo: bb, matrix: G.xf(1, 2, 3, 0.3, 0.2, 0.1), color: new THREE.Color(0x6f7240) }, { geo: w, matrix: new THREE.Matrix4().makeScale(-1, 1, 1), color: new THREE.Color(0x808080) }];
  const mine = G.merge(parts), theirs = mergeParts(parts, true);
  for (const k of ['position', 'normal', 'color']) assert.ok(mine.attributes[k].array.every((v, i) => Math.abs(v - theirs.attributes[k].array[i]) < 1e-6), `merge: same ${k} as mergeParts`);
  assert.deepEqual([...mine.index.array], [...theirs.index.array], 'merge: same triangles as mergeParts');
  const grey = new THREE.Color(0x808080), tire = new THREE.Color(0x2b2a26);
  assert.ok(colorsOf(mine).has([tire.r * grey.r, tire.g * grey.g, tire.b * grey.b].map((v) => v.toFixed(4)).join()), 'merge: paint times the shape color');
  assert.equal(bb.attributes.color, undefined, 'merge leaves its inputs alone');

  // materials for the model textures: a shape's own ids win, a merge item's or part's mat fills what it left unset,
  // crease keeps them, and mergeParts bakes the grime into the fraction without changing the id
  const id = (name) => G.MATS.indexOf(name), idsOf = (g) => new Set([...g.attributes.matId.array].map(G.baseMat));
  assert.throws(() => G.matId('chrome'), /unknown model material/, 'matId: a misspelled material throws');
  assert.deepEqual(idsOf(w), new Set([id('rubber'), G.UNSET]), 'wheel: a rubber tire, the disc left to the model');
  const onHull = G.merge([{ geo: w, mat: 'armor-paint' }, { geo: G.tag(bb, 'plain'), mat: 'wood' }]);
  assert.deepEqual(idsOf(onHull), new Set([id('rubber'), id('armor-paint'), G.PLAIN]), 'merge: mat fills only the unset vertices');
  assert.deepEqual(idsOf(G.crease(onHull, 40)), idsOf(onHull), 'crease keeps the material ids');
  assert.ok(G.track(4, 0.45, 40).attributes.matId.array.every((v) => v === id('track-steel')), 'track: links are track steel');
  const baked = mergeParts([{ geo: w, matrix: G.xf(0, 0.5), color: new THREE.Color(0xffffff) }, { geo: bb, matrix: G.xf(0, 3), color: new THREE.Color(0x2a2a24) }], true, 'vehicle');
  const M = baked.attributes.matId, PY = baked.attributes.position, grime = (i) => (M.getX(i) - G.baseMat(M.getX(i))) * 2;
  assert.deepEqual(idsOf(baked), new Set([id('rubber'), id('armor-paint'), id('gunmetal')]), 'mergeParts: unset takes the look default, near-black paint is gunmetal');
  let floor = 0, roof = 1;
  for (let i = 0; i < M.count; i++) { assert.ok(grime(i) >= 0 && grime(i) < 1, 'grime stays in its fraction'); if (PY.getY(i) < 0.1) floor = Math.max(floor, grime(i)); if (PY.getY(i) > 3) roof = Math.min(roof, grime(i)); }
  assert.ok(floor > 0.8 && roof < 0.4, `mud at the bottom (${floor.toFixed(2)}), only dust up top (${roof.toFixed(2)})`);

  // markings: flat at the lift, facing +z, areas add up (no overlaps), the colors asked
  const s = G.star(1, { lift: 0.02 }), S = s.attributes.position, SN = s.attributes.normal;
  for (let i = 0; i < S.count; i++) assert.ok(Math.abs(S.getZ(i) - 0.02) < 1e-7 && SN.getZ(i) === 1,'star: flat at the lift, facing +z');
  near(area(s), 5 * 0.382 * Math.sin(Math.PI / 5), 1e-3, 'star area');
  const us = G.star(1, { disc: 0x2a4a8f });
  near(area(us), 16 * Math.sin(Math.PI / 16) * 1.06 ** 2, 1e-3, 'star in a disc: the star is cut out of the disc');
  assert.deepEqual([...colorsOf(us)].sort(), [hex(0xece6d6), hex(0x2a4a8f)].sort(), 'star in a disc: two colors');
  near(area(G.balkenkreuz(1)), 8 * 0.2 - 4 * 0.04 + 4 * 0.12 * (2 - 0.4 - 0.12), 1e-6, 'balkenkreuz: black cross plus four white edges');
  near(area(G.roundel(1)), 16 * Math.sin(Math.PI / 16), 1e-6, 'roundel: bands fill the disc once');
  const top = G.merge([{ geo: G.roundel(0.5), matrix: G.place([0, 1, 0], [0, 1, 0]) }]), TP = top.attributes.position;
  for (let i = 0; i < TP.count; i++) near(TP.getY(i), 1.01, 1e-6, 'place: a roundel lies on a roof');

  // ao: darker at the floor than at the top, the input untouched
  const lit = G.ao(bb), C = lit.attributes.color, Y = lit.attributes.position;
  let low = 1, high = 0;
  for (let i = 0; i < C.count; i++) { if (Y.getY(i) < -0.249) low = Math.min(low, C.getX(i)); if (Y.getY(i) > 0.249) high = Math.max(high, C.getX(i)); }
  assert.ok(low < 0.6 && high === 1, `ao: floor ${low} darker than the top ${high}`);
  assert.equal(bb.attributes.color, undefined, 'ao leaves its input alone');
  assert.ok(G.ao(bb, { falloff: () => 0.5 }).attributes.color.array.every((v) => v === 0.5), 'ao: a custom falloff');
}
console.log('all model toolkit checks passed');

// Armor keeps one hull and one traversing draw, outward faces and muzzle points, inside the model budgets.
{
  const THREE = await import('three');
  const { buildModel, PAINT, VEHICLE_PAINT } = await import('./client/unit-models.js');
  const looks = [{ vehicle: 0x59623d, color: 0x3b73d6 }, { vehicle: 0x50565a, color: 0xcc3a2e }, { vehicle: 0x4e5a38, color: 0xece6d6 }, { vehicle: 0x565640, color: 0xe2832b }];
  const cases = [['tank', 0, 3000], ['tank', 1, 3000], ['tank', 2, 3000], ['tiger', 1, 5000], ['churchill', 3, 5000],
    ['medium', 0, 4000], ['medium', 1, 4000], ['medium', 2, 4000], ['medium', 3, 4000], ['rocket', 0, 4000], ['flaktrack', 1, 4000], ['flaktrack', 2, 3000]];
  for (const [type, fac, budget] of cases) {
    const root = new THREE.Group(), v = { type, root, models: [] }, label = `${type} faction ${fac}`;
    buildModel(v, root, looks[fac], fac, UNITS[type]);
    const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
    assert.equal(meshes.length, 2, `${label}: one hull and one turret draw`);
    assert.ok(meshes.every(m => m.material === VEHICLE_PAINT), `${label}: shares the vehicle fill material`);
    const tris = meshes.reduce((sum, m) => sum + m.geometry.index.count / 3, 0);
    assert.ok(tris <= budget, `${label}: ${tris} triangles within ${budget}`);
    let tipDistance = Infinity;
    for (const mesh of meshes) {
      const geo = mesh.geometry, P = geo.attributes.position, N = geo.attributes.normal, I = geo.index;
      assert.ok(geo.attributes.color && geo.attributes.matId && P.array.every(Number.isFinite), `${label}: finite textured geometry`);
      const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), face = a.clone(), normal = a.clone();
      for (let i = 0; i < I.count; i += 3) {
        const ids = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
        a.fromBufferAttribute(P, ids[0]); b.fromBufferAttribute(P, ids[1]); c.fromBufferAttribute(P, ids[2]);
        face.subVectors(b, a).cross(c.sub(a)); normal.set(0, 0, 0);
        for (const id of ids) normal.add(new THREE.Vector3().fromBufferAttribute(N, id));
        assert.ok(face.lengthSq() > 1e-15 && face.dot(normal) >= -1e-8, `${label}: visible faces agree with their normals`);
      }
      if (mesh.parent === v.turret) for (let i = 0; i < P.count; i++) tipDistance = Math.min(tipDistance, a.fromBufferAttribute(P, i).distanceTo(new THREE.Vector3(...v.fxTip)));
    }
    assert.ok(tipDistance < 0.1, `${label}: muzzle point stays on the gun`);
  }
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  VEHICLE_PAINT.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance += diffuseColor.rgb') && shader.fragmentShader.includes('modelTriplanar'), 'vehicle fill keeps the model texture shader');
  const ordinary = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  PAINT.onBeforeCompile(ordinary);
  assert.ok(!ordinary.fragmentShader.includes('totalEmissiveRadiance += diffuseColor.rgb'), 'soldiers and guns retain their own lighting');
}
console.log('all armor model checks passed');

// Wheeled and half-tracked models (client/models/wheeled.js): the armored cars, the M16 and the two rocket trucks are two
// shadow-casting draws with a traversing part, stay close to the footprint of the boxes they replaced and within their
// triangle budgets, carry their own vertex colors, and put the muzzle point where the traversing part is.
{
  const THREE = await import('three');
  const { buildModel } = await import('./client/unit-models.js');
  const { isWheeled, wheeledModel } = await import('./client/models/wheeled.js');
  const look = { uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 };
  const cases = [['armoredcar', 0], ['armoredcar', 1], ['armoredcar', 2], ['flaktrack', 0], ['rocket', 1], ['rocket', 2]];
  assert.ok(cases.every(([t, f]) => isWheeled(t, f)) && !isWheeled('rocket', 0) && !isWheeled('flaktrack', 1) && !isWheeled('tank', 0), 'wheeled.js builds exactly its own units');
  for (const [type, fac] of cases) {
    const label = `${type} (faction ${fac})`, root = new THREE.Group(), v = { type, root, models: [], turret: null };
    buildModel(v, root, look, fac, UNITS[type]);
    const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    assert.equal(meshes.length, 2, `${label}: a hull and a turret, two draws`);
    assert.ok(meshes.every((m) => m.castShadow && m.geometry.attributes.color), `${label}: casts shadows, carries its own colors`);
    assert.ok(v.turret && v.turret.children.length === 1 && v.models[0] === root, `${label}: the turret node holds the traversing part`);
    const m = wheeledModel(type, fac, look), box = new THREE.Box3().setFromBufferAttribute(m.hull.attributes.position);
    const tb = new THREE.Box3().setFromBufferAttribute(m.turret.attributes.position).translate(new THREE.Vector3(...m.turretAt));
    box.union(tb);
    const size = box.getSize(new THREE.Vector3()), tris = (m.hull.index.count + m.turret.index.count) / 3;
    assert.ok(box.min.y > -0.05 && box.min.y < 0.05, `${label}: stands on the ground (${box.min.y})`);
    assert.ok(size.x >= 3.4 && size.x <= 5.8 && size.z >= 1.6 && size.z <= 2.8, `${label}: footprint ${size.x.toFixed(1)} x ${size.z.toFixed(1)} stays near the old boxes`);
    assert.ok(tris >= 1500 && tris <= 3000, `${label}: ${tris} triangles within the 3000 budget`);
    for (const g of [m.hull, m.turret]) assert.ok(g.attributes.position.array.every(Number.isFinite) && g.attributes.normal.array.every(Number.isFinite), `${label}: finite positions and normals`);
    assert.ok(v.fxTip.length === 3 && v.fxTip.every(Number.isFinite), `${label}: a muzzle point`);
    const own = new THREE.Box3().setFromBufferAttribute(m.turret.attributes.position).expandByScalar(0.35);
    assert.ok(own.containsPoint(new THREE.Vector3(...v.fxTip)), `${label}: the muzzle point sits at the end of the gun or launcher`);
    assert.equal(wheeledModel(type, fac, look), m, `${label}: the geometry is cached per look`);
  }
}
console.log('all wheeled model checks passed');

// Crew-served guns (client/models/guns.js): every weapon of every faction is one shadow-casting mesh inside its triangle
// budget with faces that agree with their normals, guns that traverse carry their muzzle in v.fxTip, the muzzles sit where
// client/fx.js starts its tracers and shells, the crew stands clear of the gun, and a cheap far version (one mesh under 500
// triangles) takes over with the far-away soldiers.
{
  const THREE = await import('three');
  const { buildModel, animate } = await import('./client/unit-models.js');
  const { gunModel, GUN_SLOTS } = await import('./client/models/guns.js');
  const looks = [{ uniform: 0x6b7248, vehicle: 0x59623d, color: 0x3b73d6 }, { uniform: 0x5c6266, vehicle: 0x50565a, color: 0xcc3a2e }, { uniform: 0x7d7250, vehicle: 0x4e5a38, color: 0xece6d6 }, { uniform: 0x6f6448, vehicle: 0x565640, color: 0xe2832b }];
  const nearest = (geo, p, off = [0, 0, 0], minY = -1) => {
    const P = geo.attributes.position;
    let best = Infinity;
    for (let i = 0; i < P.count; i++) if (P.getY(i) >= minY) best = Math.min(best, Math.hypot(P.getX(i) + off[0] - p[0], P.getY(i) + off[1] - p[1], P.getZ(i) + off[2] - p[2]));
    return best;
  };
  for (const type of ['mg', 'mortar', 'at', 'flak']) for (const fac of [0, 1, 2, 3]) {
    const label = `${type} (faction ${fac})`, look = looks[fac], root = new THREE.Group(), v = { type, root, models: [], turret: null, x: 0, z: 0 };
    buildModel(v, root, look, fac, UNITS[type]);
    // the weapon is every visible mesh under the root outside the soldiers (their nodes carry a formation slot)
    const meshes = [];
    for (const o of root.children) if (!o.userData.slot) o.traverseVisible((m) => { if (m.isMesh) meshes.push(m); });
    assert.equal(meshes.length, 1, `${label}: the gun is one draw call`);
    assert.ok(meshes[0].castShadow, `${label}: the gun casts a shadow`);
    const geo = meshes[0].geometry, I = geo.index, P = geo.attributes.position, N = geo.attributes.normal, tris = I.count / 3;
    assert.ok(tris >= 400 && tris <= 2000, `${label}: ${tris} triangles (budget 2000)`);
    assert.ok(geo.attributes.color, `${label}: painted in vertex colors`);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    let inward = 0;
    for (let i = 0; i < I.count; i += 3) {
      a.fromBufferAttribute(P, I.getX(i)); b.fromBufferAttribute(P, I.getX(i + 1)); c.fromBufferAttribute(P, I.getX(i + 2));
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      if (face.lengthSq() < 1e-14) continue;
      n.fromBufferAttribute(N, I.getX(i)).add(new THREE.Vector3().fromBufferAttribute(N, I.getX(i + 1))).add(new THREE.Vector3().fromBufferAttribute(N, I.getX(i + 2)));
      if (face.dot(n) <= 0) inward++;
    }
    assert.equal(inward, 0, `${label}: every face points the way its normals do`);
    const pivot = v.turret ? v.turret.position.toArray() : [0, 0, 0];
    if (type === 'at' || type === 'flak') {
      assert.ok(v.turret && v.fxTip?.length === 3, `${label}: traverses with its muzzle in v.fxTip`);
      assert.ok(nearest(geo, v.fxTip) < 0.15, `${label}: v.fxTip sits on the end of the barrel (${nearest(geo, v.fxTip).toFixed(2)} m)`);
    } else assert.ok(!v.turret, `${label}: a static weapon`);
    if (type === 'mg') assert.ok(nearest(geo, [1.72, 0.45, 0]) < 0.08, `${label}: the muzzle is where fx.js starts the tracers`);
    if (type === 'mortar') assert.ok(nearest(geo, [1.1, 1.12, 0]) < 0.1, `${label}: the tube mouth is where fx.js launches the shell`);
    for (const [sx, sz] of GUN_SLOTS[type]) assert.ok(nearest(geo, [sx * 1.3, 0.3, sz * 1.3], [pivot[0], 0, pivot[2]], 0.15) >= 0.4, `${label}: crew slot ${sx},${sz} stands clear of the gun`);
    // far away the cheap version is the one drawn
    const farGeo = gunModel(type, fac, look).far, farMeshes = [];
    assert.ok(farGeo && farGeo.index.count / 3 <= 500, `${label}: a far version under 500 triangles`);
    assert.ok(farGeo.attributes.position.array.every(Number.isFinite) && farGeo.attributes.color, `${label}: the far version is finite and painted`);
    animate(v, 0, new THREE.Vector3(0, 160, 160));
    for (const o of root.children) if (!o.userData.slot) o.traverseVisible((m) => { if (m.isMesh) farMeshes.push(m); });
    assert.ok(farMeshes.length === 1 && farMeshes[0] !== meshes[0] && farMeshes[0].geometry.index.count / 3 <= 500, `${label}: one cheap draw call far away`);
    animate(v, 0, new THREE.Vector3(0, 8, 8));
    const backNear = []; for (const o of root.children) if (!o.userData.slot) o.traverseVisible((m) => { if (m.isMesh) backNear.push(m); });
    assert.ok(backNear.length === 1 && backNear[0] === meshes[0], `${label}: the full gun is back when the camera comes close`);
  }
  for (const fac of [0, 1, 2]) {
    const geo = gunModel('flakpos', fac, looks[fac]).geo;
    for (const z of [-0.2, 0.2]) assert.ok(nearest(geo, [0.95, 2.1, z]) < 0.1, `flakpos (faction ${fac}): a barrel ends at fx.js's muzzle point`);
    assert.ok(geo.index.count / 3 <= 2000, 'flakpos gun inside its triangle budget');
  }
}
console.log('all gun model checks passed');

// Aircraft (client/models/planes.js): every plane of every faction fits its triangle budget with its propellers (about
// 60 triangles a blade and a blur disc each in client/aircraft.js), its faces agree with its normals, every vertex
// says what it is made of, and the owner's colour stays a small marking instead of covering the paint.
{
  const THREE = await import('three');
  const { plane, ROLES, PLANE_NAMES } = await import('./client/models/planes.js');
  const { MATS, PLAIN, UNSET } = await import('./client/models/geom.js');
  const BUDGET = { fighter: 3500, attacker: 3500, bomber: 6000, transport: 6000 }, OWN = 0xff00ff;
  for (const fac of [0, 1, 2, 3]) for (const role of ROLES) {
    const p = plane(fac, role, OWN), geo = p.geo, label = PLANE_NAMES[fac][role];
    const I = geo.index, P = geo.attributes.position, N = geo.attributes.normal, col = geo.attributes.color, mat = geo.attributes.matId;
    const tris = I.count / 3 + p.props.reduce((s, q) => s + q.n * 60 + 36, 0) + 2;
    assert.ok(tris <= BUDGET[role], `${label}: ${tris} triangles with its propellers (budget ${BUDGET[role]})`);
    assert.ok(geo.attributes.camo && geo.attributes.hinge && mat, `${label}: carries the camo, hinge and matId attributes`);
    assert.ok(mat.array.every((m) => m === PLAIN || m === UNSET || (Number.isInteger(m) && m >= 0 && m < MATS.length)), `${label}: every matId is a material, plain or the default`);
    // the owner's colour here is magenta, darkened a little by the ambient occlusion: no paint is anything like it
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const own = (k) => col.getX(k) > 0.5 && col.getZ(k) > 0.5 && col.getY(k) < 0.15 && Math.abs(col.getX(k) - col.getZ(k)) < 0.05;
    let inward = 0, area = 0, owned = 0;
    for (let i = 0; i < I.count; i += 3) {
      const v = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
      a.fromBufferAttribute(P, v[0]); b.fromBufferAttribute(P, v[1]); c.fromBufferAttribute(P, v[2]);
      const face = b.clone().sub(a).cross(c.clone().sub(a)), s = face.length() / 2;
      area += s;
      if (v.every(own)) owned += s;
      if (s < 1e-7) continue;
      n.set(0, 0, 0);
      for (const k of v) n.add(new THREE.Vector3().fromBufferAttribute(N, k));
      if (face.dot(n) <= 0) inward++;
    }
    assert.ok(inward <= I.count / 3 * 0.002, `${label}: ${inward} faces point against their normals`);
    assert.ok(owned > 0 && owned / area < 0.06, `${label}: the owner's colour covers ${(100 * owned / area).toFixed(1)}% of the plane`);
  }
}
console.log('all aircraft model checks passed');

// Infantry rigs must keep complete morph targets, one body per LOD, and usable prone firing poses.
{
  const { soldier, soldierKit, rigOf } = await import('./client/models/infantry.js');
  const THREE = await import('three');
  const { buildModel } = await import('./client/unit-models.js');
  const types = ['rifle', 'conscript', 'ranger', 'commando', 'engineer', 'sniper', 'mg', 'mortar', 'at', 'flak'];
  for (const fac of [0, 1, 2, 3]) for (const type of types) {
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const kit = soldierKit(type, i, fac);
      if (seen.has(kit)) continue;
      seen.add(kit);
      const s = soldier(type, fac, i, { color: 0xff00ff });
      for (const [lod, budget] of [['near', 900], ['far', 150]]) {
        assert.equal(s[lod].children.length, 1, `${type}/${fac}/${kit}: one ${lod} body`);
        const g = s[lod].children[0].userData.geo, p = g.attributes.position;
        assert.ok(g.index.count / 3 <= budget, `${type}/${fac}/${kit}: ${lod} fits ${budget} triangles`);
        assert.equal(g.userData.poses.length, 3, `${type}/${fac}/${kit}: all suppression and retreat poses`);
        for (const pose of g.userData.poses) {
          assert.equal(pose.position.count, p.count, `${type}/${fac}/${kit}: morph vertex count`);
          assert.equal(pose.normal.count, p.count, `${type}/${fac}/${kit}: morph normal count`);
          assert.ok(pose.position.array.every(Number.isFinite) && pose.normal.array.every(Number.isFinite), `${type}/${fac}/${kit}: finite pose attributes`);
        }
      }
      const prone = rigOf(type, fac, i, 2);
      assert.ok(prone.legs.every(l => l.ankle.y < 0.2 && l.knee.y < 0.2), `${type}/${fac}/${kit}: prone legs rest near the ground`);
      assert.ok(prone.arms.every(a => a.err < 0.045), `${type}/${fac}/${kit}: prone hands within reach`);
      if (type === 'rifle' && kit !== 'leader') {
        const barrel = new THREE.Vector3(1, 0, 0).transformDirection(prone.W);
        assert.ok(Math.abs(barrel.y) < 0.08, `${fac}/${kit}: prone rifle stays level`);
        assert.ok(prone.arms.every(a => a.elbow.y > 0.02 && a.elbow.y < 0.15), `${fac}/${kit}: prone elbows support the rifle`);
      }
    }
  }
  for (const fac of [0, 1, 2]) {
    const v = { type: 'medic', owner: fac, models: [] }, root = new THREE.Group();
    buildModel(v, root, { color: 0xff00ff, uniform: 0x777755, vehicle: 0x555544 }, fac, UNITS.medic);
    assert.equal(v.models.length, 2, 'medics retain their two figures');
    for (const man of v.models) for (const lod of ['hi', 'lo']) {
      assert.equal(man.userData[lod].length, 1, 'each medic remains one draw per LOD');
      assert.ok(man.userData[lod][0].geometry.morphAttributes.position.length >= 3, 'medics retain suppression and retreat morphs');
    }
  }
  const poses = [1, 2, 3].map(i => rigOf('rifle', 0, i, 0));
  assert.equal(new Set(poses.map(r => r.s.stance)).size, 3, 'riflemen use stride, brace and standing stances');
}
console.log('all infantry model checks passed');

// Shell holes, rubble and burnt ground are painted by the client, then read back. A filled cell square fails.
{
  class ImageData {
    constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
  }
  class Ctx {
    constructor(canvas) { this.canvas = canvas; this._buf = null; }
    _ensure() {
      const { width, height } = this.canvas;
      if (!this._buf || this._buf.width !== width || this._buf.height !== height) this._buf = new ImageData(width, height);
      return this._buf;
    }
    createImageData(w, h) { return new ImageData(w, h); }
    putImageData(img, x, y) {
      const buf = this._ensure(), W = buf.width;
      for (let row = 0; row < img.height; row++) {
        const dy = y + row;
        if (dy < 0 || dy >= buf.height) continue;
        const sx = Math.max(0, x), sw = Math.min(img.width - (sx - x), W - sx);
        if (sw <= 0) continue;
        buf.data.set(img.data.subarray((row * img.width + (sx - x)) * 4, (row * img.width + (sx - x)) * 4 + sw * 4), (dy * W + sx) * 4);
      }
    }
    getImageData(x, y, w, h) {
      const buf = this._ensure(), out = new ImageData(w, h);
      for (let row = 0; row < h; row++) {
        const dy = y + row;
        if (dy < 0 || dy >= buf.height) continue;
        const sx = Math.max(0, x), sw = Math.min(w - (sx - x), buf.width - sx);
        if (sw <= 0) continue;
        out.data.set(buf.data.subarray((dy * buf.width + sx) * 4, (dy * buf.width + sx) * 4 + sw * 4), (row * w + (sx - x)) * 4);
      }
      return out;
    }
    save() {} restore() {} beginPath() {} rect() {} clip() {} arc() {} ellipse() {} fill() {} stroke() {}
    fillRect() {} moveTo() {} lineTo() {} closePath() {} clearRect() {} drawImage() {}
    createRadialGradient() { return { addColorStop() {} }; }
    set fillStyle(v) {} set strokeStyle(v) {} set lineWidth(v) {} set lineCap(v) {} set lineJoin(v) {}
    set imageSmoothingEnabled(v) {} set imageSmoothingQuality(v) {}
  }
  class Canvas {
    constructor() { this.width = 0; this.height = 0; }
    getContext() { return this._ctx || (this._ctx = new Ctx(this)); }
  }
  class Img {
    constructor() { this._l = {}; }
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter(f => f !== fn); }
    set src(_) { queueMicrotask(() => { this.onerror?.(); for (const fn of this._l.error || []) fn.call(this, {}); }); }
  }
  globalThis.document = { createElement: () => new Canvas(), createElementNS: () => new Img() };
  globalThis.Image = Img;
  globalThis.window = globalThis;

  const { createGround } = await import('./client/ground.js');
  const W = 16, H = 16;
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
  grid[4][4] = 'R';
  grid[8][4] = '+';
  for (let y = 8; y <= 10; y++) for (let x = 8; x <= 10; x++) grid[y][x] = 'R';
  const state = new Uint8Array(W * H);
  state[12 * W + 4] = 4;
  const map = { w: W, h: H, rows: grid.map(row => row.join('')), spawns: [{ x: 8, y: 8 }] };
  const ground = createGround(map);
  await ground.loading;
  ground.paint(grid, state);
  const P = ground.px;
  let frame = ground.ctx.getImageData(0, 0, W * P, H * P);
  const snap = () => { frame = ground.ctx.getImageData(0, 0, W * P, H * P); };
  const pix = (x, y) => {
    const i = ((Math.round(y) * W * P + Math.round(x)) * 4);
    return [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
  };
  const avg = (u, v) => {
    const cx = u * P - 0.5, cy = v * P - 0.5;
    let r = 0, g = 0, b = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = pix(cx + dx, cy + dy);
      r += p[0]; g += p[1]; b += p[2]; k++;
    }
    return [r / k, g / k, b / k];
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const clean = [];
  for (let y = 0.3; y < 2.7; y += 0.25) for (let x = 0.3; x < 2.7; x += 0.25) clean.push(avg(x, y));
  const dClean = (p) => clean.reduce((m, s) => Math.min(m, dist(p, s)), Infinity);
  const lines = [`P=${P}`];
  const scarCell = (name, cx, cy) => {
    const center = avg(cx + 0.5, cy + 0.5);
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => avg(cx + 0.04 + a * 0.92, cy + 0.04 + b * 0.92));
    const cd = dClean(center), kd = corners.map(dClean);
    let dom = 0, n = 0;
    for (let y = cy * P + 1; y < (cy + 1) * P - 1; y += 2) for (let x = cx * P + 1; x < (cx + 1) * P - 1; x += 2) {
      n++;
      const p = pix(x, y);
      if (dist(p, center) + 6 < dClean(p)) dom++;
    }
    const fill = dom / n;
    lines.push(`${name} center=${cd.toFixed(1)} corners=${kd.map(v => v.toFixed(1)).join(',')} fill=${fill.toFixed(3)}`);
    assert.ok(kd.every(v => cd > v + 6), `${name}: the middle (${cd.toFixed(1)}) is no further from clean ground than a corner`);
    assert.ok(kd.every(v => v < 20), `${name}: a corner is still painted as the blast (${kd.map(v => v.toFixed(1)).join(',')})`);
    assert.ok(fill > 0.15 && fill < 0.93, `${name}: blast fill ${fill.toFixed(3)} is a cell square or empty`);
    return center;
  };
  scarCell('rubble', 4, 4);
  scarCell('crater', 4, 8);
  const burnCenter = scarCell('burnt', 4, 12);
  const interior = avg(9.5, 9.5), edge = avg(9, 8.5), outer = avg(8.05, 8.05);
  lines.push(`block interior=${dClean(interior).toFixed(1)} edge=${dClean(edge).toFixed(1)} outer=${dClean(outer).toFixed(1)} edgeToInterior=${dist(edge, interior).toFixed(1)}`);
  assert.ok(dClean(edge) > dClean(outer) + 6, 'a rubble block reads as separate squares along the shared edge');
  assert.ok(dClean(outer) < 12, 'the outer corner of a rubble block is still the cell square');
  assert.ok(dist(edge, interior) < dClean(edge), 'the shared edge of a rubble block is not the blast');

  state[12 * W + 4] = 0;
  ground.paint(grid, state);
  snap();
  const cleared = avg(4.5, 12.5);
  lines.push(`burn cleared=${dClean(cleared).toFixed(1)}`);
  assert.ok(dClean(cleared) < 25, 'clearing a burn left the scar in place');
  state[12 * W + 4] = 4;
  ground.paint(grid, state);
  snap();
  const again = avg(4.5, 12.5);
  lines.push(`burn restored d=${dist(burnCenter, again).toFixed(2)}`);
  assert.ok(dist(burnCenter, again) < 2, 'repainting a burn does not match the first paint');

  for (let x = 8; x <= 15; x++) grid[1][x] = '+';
  ground.paint(grid, state);
  snap();
  const widths = [], mids = [];
  for (let x = 8.25; x <= 15.25; x += 0.5) {
    let lo = null, hi = null;
    for (let v = 0.15; v <= 2.5; v += 0.05) {
      if (dClean(avg(x, v)) > 26) {
        if (lo == null) lo = v;
        hi = v;
      }
    }
    widths.push(hi == null ? 0 : +(hi - lo).toFixed(2));
    mids.push(+dClean(avg(x, 1.5)).toFixed(1));
  }
  const wmin = Math.min(...widths), wmax = Math.max(...widths);
  lines.push(`line widths=${widths.join(',')} span=${(wmax - wmin).toFixed(2)} mids=${mids.join(',')}`);
  assert.ok(wmin > 0.1, `a bomb line breaks (min width ${wmin})`);
  assert.ok(wmax - wmin >= 0.25, `a bomb line is an even ribbon (span ${(wmax - wmin).toFixed(2)})`);
  assert.ok(mids.some(v => v < 25) && mids.some(v => v > 60), 'a bomb line does not pinch and open');

  const { buildStructures } = await import('./client/structures.js');
  const TW = 14, TH = 8;
  const orig = Array.from({ length: TH }, () => '.'.repeat(TW).split(''));
  const live = orig.map(row => row.slice());
  for (let y = 2; y < 4; y++) for (let x = 2; x < 5; x++) orig[y][x] = 'B';
  for (let y = 2; y < 4; y++) for (let x = 8; x < 11; x++) orig[y][x] = 'B';
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) live[y][x] = orig[y][x];
  for (let y = 2; y < 4; y++) live[y][4] = 'R';
  for (let y = 2; y < 4; y++) for (let x = 8; x < 11; x++) live[y][x] = 'R';
  const THREE = await import('three');
  const group = new THREE.Group();
  buildStructures(group, live, orig, () => 0);
  const foot = [];
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (orig[y][x] === 'B') foot.push([x, y]);
  const cell = 2;
  let pieces = 0, outside = 0, boxy = 0;
  for (const mesh of group.children) {
    const a = mesh.instanceMatrix.array;
    for (let i = 0; i < mesh.count; i++) {
      const o = i * 16;
      const sx = Math.hypot(a[o], a[o + 1], a[o + 2]), sz = Math.hypot(a[o + 8], a[o + 9], a[o + 10]);
      const x = a[o + 12], z = a[o + 14];
      pieces++;
      if (sx > 2.2 && sz > 2.2) boxy++;
      const inside = foot.some(([fx, fy]) => x > fx * cell - 0.3 && x < (fx + 1) * cell + 0.3 && z > fy * cell - 0.3 && z < (fy + 1) * cell + 0.3);
      if (!inside) outside++;
    }
  }
  lines.push(`wrecks pieces=${pieces} boxy=${boxy} outside=${outside}`);
  assert.ok(pieces > 8, 'a ruined house produced no wreckage');
  assert.equal(boxy, 0, 'a ruin still has a footprint-sized box');
  assert.ok(outside > 0, 'rubble stays inside the cell square');
  console.log(lines.join('\n'));
  if (process.env.GOAL_SCRATCH) writeFileSync(`${process.env.GOAL_SCRATCH}/scar-pixels.log`, lines.join('\n') + '\n');
}
console.log('all destruction paint checks passed');

await stopServerHarness(); // the last server check is done
// The public lobby checks own a fresh server with a deliberately small room cap.
{
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['test-public-lobby.js'], { cwd: import.meta.dirname, stdio: 'inherit', timeout: 30000 });
}

// Performance checks exercise the same painting, rendering and path interfaces used by the game.
{
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['test-performance.mjs'], { cwd: import.meta.dirname, stdio: 'inherit', timeout: 240000 });
}
