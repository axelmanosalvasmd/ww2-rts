// Headless sim checks: `node test.js`. Fails loudly if core rules break.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, step, command, los, findPath, snapshotFor, CFG, CELL } from './shared/sim.js';
import { think } from './shared/ai.js';

const blank = (rows) => ({ w: rows[0].length, h: rows.length, rows, spawns: [{ x: 1, y: 1 }, { x: 18, y: 1 }, { x: 1, y: 18 }], points: [{ x: 10, y: 10 }] });
const empty = Array(20).fill('.'.repeat(20));
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) step(g); };
const fresh = (rows = empty, n = 2) => { const g = createGame(blank(rows), ['a', 'b', 'c'].slice(0, n)); g.units.clear(); return g; };
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
}
console.log('all sim checks passed');
