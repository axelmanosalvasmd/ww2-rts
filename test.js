// Headless sim checks: `node test.js`. Fails loudly if core rules break.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as sim from './shared/sim.js';
import { createGame, step, command, los, findPath, validateMap, snapshotFor, snapshotCache, inTrench, vet, spawnSlots, popOf, popCap, CFG, CELL, SUPPORT, UNITS, teamSees, levelOf } from './shared/sim.js';
import { SpatialGrid, updateGrid } from './shared/grid.js';
import { think } from './shared/ai.js';
import { unitRole } from './client/unit-roles.js';
import { createRelief } from './client/relief.js';

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
  g.nodes.forEach(n => n.depot = barracks.id); // Every node is already claimed, so there is no depot to save for.
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
const UNITS_COST = (t) => ({ rifle: 100, mg: 150, at: 200, tank: 300, rocket: 250, ranger: 185, tiger: 620, conscript: 80 })[t];
const put = (g, owner, type, x, z) => { command(g, owner, { t: 'buy', unit: type }); const u = [...g.units.values()].at(-1); u.x = x; u.z = z; return u; };

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
  run(g, 15);
  assert.ok(los(g, { x: 5, z: 20 }, { x: 35, z: 20 }), 'smoke clears');
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
  assert.equal(g.height.filter(l => l < 0).length, 1, 'shells dig a single cell (bombs dig more)');
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
  for (let i = 0; i < 1500; i++) { a.hp = 100; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) inside++; }
  command(g, 0, { t: 'move', orders: [[a.id, 19, 30]] });
  assert.equal(a.garrison, -1, 'a move order leaves the building');
  run(g, 3);
  for (let i = 0; i < 1500; i++) { a.hp = 100; a.x = 19; a.z = 30; foe.hp = 75; foe.supp = 0; foe.cooldown = 0; foe.targetId = a.id; foe.retarget = 1; step(g); if (a.hp < 100) open++; }
  assert.ok(inside < open * 0.8, `garrison is harder to hit (${inside} vs ${open})`);
  // wreck the house with the MG inside
  const orig = Math.random; Math.random = () => 0.5;
  command(g, 0, { t: 'support', kind: 'artillery', x: 19, z: 21, dir: 0 });
  run(g, SUPPORT.artillery.delay + 5);
  Math.random = orig;
  assert.ok(!g.units.has(b.id) || (b.garrison === -1 && b.hp < 75), 'squad thrown out and hurt when the house falls');
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
  // Tiger: the front takes 60%, the rear 200%
  const g = fresh(); g.players[0].mp = g.players[1].mp = 5000;
  g.players[1].slot = 1;
  command(g, 1, { t: 'buy', unit: 'tiger' });
  const tg = [...g.units.values()].at(-1); tg.x = 20; tg.z = 20; tg.rot = 0; // facing +x
  const at = put(g, 0, 'at', 40, 20); at.still = 5;
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
  assert.deepEqual(spawnSlots(6, [0, 1], false), [0, 3], '1v1 on a 6-spawn map sits opposite');
  assert.deepEqual(spawnSlots(6, [0, 1, 0, 1, 0, 1], false), [0, 3, 1, 4, 2, 5], '3v3 sides');
  assert.deepEqual(spawnSlots(6, [0, 1, 2], false), [0, 2, 4], '3-way FFA spread');
  for (let i = 0; i < 20; i++) { const s = spawnSlots(6, [0, 0, 1, 1, 2, 2]); assert.equal(new Set(s).size, 6, 'no shared spawns'); }
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
  assert.equal(units.filter(u => u.amove?.x === 30 && u.amove?.z === 30).length, units.length, 'Massive attack-move reaches every selected unit');
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
  for (const t of ['mortar', 'sniper', 'armoredcar', 'medium']) { const q = fresh(); q.players[0].mp = 1000; command(q, 0, { t: 'buy', unit: t }); assert.equal(q.units.size, 1, t + ' buyable in Conquest'); }
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

// Pending paratroopers reserve a population slot until the squad arrives or its plane is shot down.
{
  for (const intercepted of [false, true]) {
    const g = fresh(); g.players[0].mp = 10000;
    for (let i = 0; i < popCap(g) - 1; i++) put(g, 0, 'rifle', 10, 10);
    const count = g.units.size;
    command(g, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
    assert.equal(g.strikes.length, 1, 'paratroopers accepted with one free population slot');
    assert.equal(popOf(g, 0), popCap(g), 'pending paratroopers reserve population');
    const mp = g.players[0].mp;
    command(g, 0, { t: 'buy', unit: 'rifle' });
    assert.equal(g.units.size, count, 'recruitment cannot take the paratroopers slot');
    assert.equal(g.players[0].mp, mp, 'rejected recruitment does not spend manpower');
    if (intercepted) g.covers = [{ team: 1, x: 20, z: 12, r: SUPPORT.cover.radius, t: SUPPORT.para.delay + 1 }];
    run(g, SUPPORT.para.delay + 0.2);
    assert.equal(g.units.size, count + (intercepted ? 0 : 1), 'accepted drop arrives unless intercepted');
    assert.equal(g.strikes.length, 0, `paratroopers ${intercepted ? 'shot down' : 'delivered'} leave no pending strike`);
    assert.equal(popOf(g, 0), g.units.size, 'the resolved drop has no pending reservation');
    if (intercepted) {
      command(g, 0, { t: 'buy', unit: 'rifle' });
      assert.equal(g.units.size, count + 1, 'a shoot-down releases the reserved population');
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
  // paratroopers: only where your side can see, and they arrive as a rifle squad
  const pa = fresh(); pa.players[0].mp = 1000;
  const eye = put(pa, 0, 'rifle', 10, 10); run(pa, 0.3);
  command(pa, 0, { t: 'support', kind: 'para', x: 300, z: 300 });
  assert.equal(pa.strikes.length, 0, 'no drop where nobody sees');
  command(pa, 0, { t: 'support', kind: 'para', x: 20, z: 12 });
  run(pa, SUPPORT.para.delay + 0.5);
  assert.equal([...pa.units.values()].filter(u => u.owner === 0 && u.type === 'rifle').length, 2, 'a squad dropped in');
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
{
  const map = JSON.parse(readFileSync('maps/default.json', 'utf8'));
  const g = createGame(map, ['a', 'b', 'c'], false, [0, 0, 1], [0, 1, 2], { mode: 'classic' });
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  g.players[0].mun = 1000;
  command(g, 0, { t: 'support', kind: 'para', x: hq.x + 10, z: hq.z });
  assert.equal(g.strikes.length, 1, 'the visible drop is ordered before elimination');
  hq.hp = 0; step(g);
  assert.equal(g.players[0].out, true, 'the player loses its last Production Building');
  assert.equal(g.winner, null, 'its teammate keeps the match running');
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

// A copy of shared/sim.js loaded from a data: URL (to reach its internals). Its relative imports (story.js, grid.js)
// point at the real files, so the copy shares those modules with the normal import.
const simCopy = (source) => import('data:text/javascript;base64,' + Buffer.from(source.replace(/from '\.\/([\w-]+\.js)'/g, (_, file) => `from '${new URL(`./shared/${file}`, import.meta.url)}'`)).toString('base64'));
// Fixed Massive fixture for exact comparisons and repeatable subsystem timings.
const massiveInternals = await simCopy(readFileSync('shared/sim.js', 'utf8')
  + '\nexport { updateVision, nearCover, behindCover, aimPoint, flagsAt, dist, spawnUnit, placeBuilding, wreckBuilding, setCell, logCell };');
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
    if (!sa && !(flagsAt(g, a.x - px, a.z - pz) & MOVE) && Math.abs(levelAt(g, a.x - px, a.z - pz) - levelAt(g, a.x, a.z)) <= 1) { a.x -= px; a.z -= pz; }
    if (!sb && !(flagsAt(g, b.x + px, b.z + pz) & MOVE) && Math.abs(levelAt(g, b.x + px, b.z + pz) - levelAt(g, b.x, b.z)) <= 1) { b.x += px; b.z += pz; }
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

// Every shipped map is valid, and every spawn can walk to every capture point and every other spawn.
for (const f of readdirSync('maps')) {
  const map = JSON.parse(readFileSync('maps/' + f, 'utf8'));
  assert.equal(validateMap(map), null, f);
  const g = createGame(map, ['a', 'b'], false), W = (p) => ({ x: (p.x + 0.5) * CELL, z: (p.y + 0.5) * CELL });
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
    const ws = new WebSocket(`ws://127.0.0.1:${module.server.address().port}/ws?room=${code}`);
    const messages = [], errors = [];
    const client = {
      code, token, ws, messages, log: messages, errors, closed: false, serverSide,
      async send(message) { await new Promise((resolve, reject) => ws.send(JSON.stringify(message), error => error ? reject(error) : resolve())); await settleServer(); },
      async late(message) { (await serverSide).emit('message', Buffer.from(JSON.stringify(message)), false); await settleServer(); },
      lobby: () => messages.filter(message => message.t === 'lobby').at(-1),
      async close() { if (ws.readyState !== 3) ws.close(); await waitFor(() => client.closed, 'client closes'); await settleServer(); },
      wait(type, predicate = () => true, after = 0) { return waitFor(() => messages.slice(after).find(message => message.t === type && predicate(message)), `client receives ${type}`); },
    };
    ws.on('message', raw => messages.push(JSON.parse(String(raw))));
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
    // count the AI's thinking: think() first reads its player's out flag
    let thinks = 0;
    Object.defineProperty(g.players[2], 'out', { get() { if (/\/ai\.js:/.test(new Error().stack)) thinks++; return undefined; }, set() {}, configurable: true });
    await ticksUntil(() => thinks > 0, 'the AI thinks during the match');
    const mine = () => [...g.units.values()].filter(u => u.owner === 0).length, before = mine();
    await ann.send({ t: 'buy', unit: 'rifle' }); assert.equal(mine(), before + 1, 'orders work during the match');
    await h.tick(3);
    const seenByAnn = new Set(h.snapshots(ann).flatMap(s => s.units.map(u => u[0])));
    const hidden = [...g.units.values()].find(u => g.players[u.owner].team === 1 && !UNITS[u.type].structure && !seenByAnn.has(u.id));
    assert.ok(hidden, 'an enemy unit Ann never saw: the fog holds while the match is on');
    assert.ok([...h.snapshots(ann), ...h.snapshots(ben)].every(s => s.end === undefined && s.winner === null && !('story' in s) && !('timeline' in s)), 'no end data while the match is on');
    assert.equal(lobbies(ann).at(-1).result, null, 'no result while the match is on');
    const nSnaps = h.snapshots(ann).length;
    for (const u of g.units.values()) if (u.type === 'bunker' && g.players[u.owner].team === 1) u.hp = 0;
    await decided(room);
    const winTick = g.tick, thought = thinks, ids = g.nextId, benUnit = [...g.units.values()].find(u => u.owner === 1 && !UNITS[u.type].structure);
    assert.equal(g.winner, 0); assert.equal(g.endReason, 'bunkers');
    // the hold: orders refused, everything in sight
    await ben.send({ t: 'buy', unit: 'rifle' }); await ben.send({ t: 'move', orders: [[benUnit.id, 5, 5]] });
    await h.tick(6);
    assert.equal(room.state, 'play', 'the match holds before the lobby');
    assert.equal(g.nextId, ids, 'no buying during the hold');
    assert.ok(!benUnit.path.length || Math.hypot(benUnit.path.at(-1).x - 5, benUnit.path.at(-1).z - 5) > 1, 'no orders during the hold');
    assert.equal(snapshotFor(g, 0, []).units.length, g.units.size, 'full vision during the hold');
    await backInLobby(room, ann);
    assert.equal(thinks, thought, 'the AI stops thinking during the hold');
    assert.equal(g.tick - winTick, 60, 'the hold runs the sim at half speed: 60 steps in 6 s');
    const held = h.snapshots(ann).slice(nSnaps);
    assert.ok(held.length >= 55 && held.every(s => s.winner === 0 && s.end.reason === 'bunkers'), 'snapshots carry the end through the hold');
    assert.ok(held.some(s => s.units.some(u => u[0] === hidden.id)), 'the fog lifts for everyone');
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
    await cal.send({ t: 'start' }); await cal.wait('start', () => true, after);
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
      const full = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(full, 'full').reason, 'seats', 'a full lobby reports occupied seats');
    });
    await check(async code => {
      const [ana, ben] = await humans(code); await start(code, ana);
      const invite = await h.connect(code, { token: code + 'invite', name: 'Invite' });
      assert.equal(last(invite, 'full').reason, 'started', 'an invite cannot claim a new seat during play');
      await ben.close(); await ana.send({ t: 'end' });
      const joined = await h.connect(code, { token: invite.token, name: 'Invite' });
      assert.equal(last(joined, 'lobby').state, 'lobby', 'the invite joins after the match returns to lobby');
      assert.equal(h.rooms.get(code).players.length, 2, 'the disconnected match seat was freed for the invite');
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
  assert.ok(Math.hypot(trooper.x - 20, trooper.z - 12) < 3, 'paratroopers landed at the chosen point');
  const at = { x: trooper.x, z: trooper.z };
  run(drop, 1);
  assert.deepEqual({ x: trooper.x, z: trooper.z }, at, 'paratroopers stay at the drop point');
}

// Classic keeps training separate from unit orders, and Engineers finish queued field and building work.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 5, y: 5 }, { x: 70, y: 70 }, { x: 5, y: 70 }], points: [{ x: 40, y: 40 }] };
  const classic = (teams = [0, 1]) => createGame(map, teams.map((_, i) => String(i)), false, teams, teams.map((_, i) => i), { mode: 'classic' });
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
  const { mergeParts, mergeMeshes, buildModel, animate, postureOf, POSTURE, LOD, CORPSES, createBodies } = await import('./client/unit-models.js');
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
  for (const [type, def] of Object.entries(UNITS)) for (const fac of [0, 1, 2]) {
    if (def.air || type === 'airfield') continue; // client/aircraft.js builds the planes and the airfield
    const root = new THREE.Group(), v = { type, root, models: [], turret: null };
    buildModel(v, root, look, fac, def);
    assert.ok(v.models.length, `${type}: has a model`);
    if (v.squad) {
      assert.equal(v.models.length, def.models, `${type}: one soldier per model`);
      for (const man of v.models) {
        const { hi, lo } = man.userData;
        assert.ok(hi.length === 1 && lo.length === 1, `${type}: a soldier is one draw near and far`);
        assert.ok(![...hi, ...lo].some((m) => m.castShadow), `${type}: soldiers cast no shadow`);
      }
    } else {
      let draws = 0;
      root.traverse((o) => { if (o.isMesh) { draws++; assert.ok(o.castShadow, `${type}: vehicles and structures cast shadows`); } });
      assert.ok(draws >= 1 && draws <= 3, `${type}: ${draws} draws`);
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
  assert.ok(man.userData.pose.rotation.z < -1.3 && muzzle.y > 0.3 && muzzle.y < 1, `lying down, weapon just above ground (${muzzle.y.toFixed(2)})`);
  animate(v, 0.016, new THREE.Vector3(0, 0, LOD.high + 10));
  assert.ok(v.squad.far && !man.userData.hi[0].visible && man.userData.lo[0].visible, 'far model beyond the LOD distance');

  const bodies = createBodies(), scene = new THREE.Scene(), world = new THREE.Group();
  scene.add(world);
  let most = 0;
  for (let i = 0; i < 600; i++) { bodies.add(world, i % 50, 0.3, i / 50); bodies.update(0.02); most = Math.max(most, bodies.count); }
  assert.ok(most <= CORPSES.cap && most > CORPSES.cap - 20, `corpses stay at or under the cap (${most})`);
  assert.equal(world.children.find((o) => o.isInstancedMesh).count, bodies.count, 'one instanced mesh draws them all');
  for (let s = 0; s < CORPSES.life + CORPSES.fade + 1; s += 0.5) bodies.update(0.5);
  assert.equal(bodies.count, 0, 'old bodies fade out and leave');
  bodies.add(world, 0, 0, 0); scene.remove(world); bodies.update(0.1);
  assert.equal(bodies.count, 0, 'a finished match empties the pool');
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
  for (let i = 0; i < 50; i++) put(g, 0, i % 4 ? 'rifle' : 'tank', 19 + (i % 7) * 0.2, 19 + Math.floor(i / 7) * 0.2);
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
      // terrain is each player's own memory (terrainFor, outside the cache): the first build takes the pending cells
      const cached = wire(snapshotFor(g, slot, shots, cells, cache)), plain = wire(snapshotFor(g, slot, shots, cells));
      assert.deepEqual({ ...cached, cells: undefined }, { ...plain, cells: undefined }, `${label}: cached wire snapshot matches player ${slot}`);
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
  assert.equal(g.height[10 * g.w + 10], 1, 'blast lowers the cliff by one level');
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
      plain[y * map.w + x] = bank ? 0 : 1;
      const height = relief.hAt((x + 0.5) * CELL, (y + 0.5) * CELL);
      assert.ok(Number.isFinite(height), `${file}: finite centre ${x},${y}`);
      if (!bank || grid[y][x] === '=') assert.ok(Math.abs(height - lv(x, y)) <= 0.1, `${file}: nominal centre ${x},${y}`);
    }
    for (const attr of Object.values(geo.attributes)) assert.ok(attr.array.every(Number.isFinite), `${file}: finite geometry`);
    let degenerate = false;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 1e-9) { degenerate = true; break; }
    }
    assert.ok(!degenerate, `${file}: nondegenerate triangles`);
    assert.ok(idx.length / 3 <= 150000, `${file}: terrain triangle ceiling`);
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
  assert.equal(placementCheck(ground, place, () => true).reason, 'blocked', 'a footprint across levels is rejected');
  assert.equal(placementCheck(ground, place, () => false).reason, 'notVisible', 'sight is checked before hidden ground');
  ground.height[flat.cells[1]] = 0;
  assert.equal(placementCheck(ground, place, at => at.x !== 19 || at.z !== 19).ok, true, 'a visible center permits an unseen corner');
  assert.equal(placementCheck(ground, { kind: 'trench', x: 21, z: 21, dir: 0 }, () => false).ok, true, 'a valid fort needs no sight');
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
    if (!teamSees(fortGame, fortGame.players[0].team, at) && placementCheck(fortGame, at, () => false).ok) { unseenFort = at; break; }
  }
  assert.ok(unseenFort, 'the map has an unseen valid fort site');
  assert.equal(command(fortGame, 0, { t: 'dig', ids: [fortEngineer.id], ...unseenFort }), undefined, 'dig accepts a valid fort in fog');
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
  eng.retreating = false;
  assert.equal(check({ t: 'build', kind: 'barracks' }).ok, true);
  hq.queue = Array(5).fill('rifle');
  assert.equal(check({ t: 'buy', unit: 'rifle' }).reason, 'The training queue is full');
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
  assert.equal(check({ t: 'ability', unit: 'rocket', ids: [rifle.id] }).reason, 'Needs 25 munitions');
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

await stopServerHarness(); // the last server check is done
