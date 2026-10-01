// Headless sim checks: `node test.js`. Fails loudly if core rules break.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join, normalize, extname } from 'node:path';
import * as sim from './shared/sim.js';
import { createGame, step, command, los, findPath, validateMap, snapshotFor, inTrench, vet, spawnSlots, popOf, popCap, CFG, CELL, SUPPORT, UNITS, teamSees } from './shared/sim.js';
import { think } from './shared/ai.js';
import { unitRole } from './client/unit-roles.js';

// Run the actual server handlers without binding sockets. Map reads can pause to expose async races.
const serverHarness = (map = readFileSync('maps/default.json', 'utf8')) => {
  let connection, held = false, waiting = [], game, tick, snapshots = 0;
  runInNewContext(readFileSync('server.js', 'utf8').replace(/^import .*;\n/gm, '').replace('import.meta.dirname', JSON.stringify(process.cwd())), {
    ...sim, think, createGame: (...args) => (game = sim.createGame(...args)), snapshotFor: (...args) => { snapshots++; return sim.snapshotFor(...args); }, join, normalize, extname, URL, Buffer,
    process: { env: { EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' } },
    http: { createServer: () => ({ listen() {} }) },
    WebSocketServer: class { on(t, fn) { if (t === 'connection') connection = fn; } },
    readFileSync: () => map, existsSync: () => true, writeFileSync() {}, writeFile: async () => {},
    readFile: async () => { if (held) await new Promise(resolve => waiting.push(resolve)); return map; },
    readdir: async () => ['default.json', 'other.json'],
    setInterval(fn) { tick = fn; }, setTimeout() {}, console: { log() {} },
  });
  return {
    game: () => game,
    tick: () => tick(), snapshots: () => snapshots,
    holdMaps() { held = true; },
    releaseMaps() { held = false; for (const resolve of waiting) resolve(); waiting = []; },
    connect() {
      const handlers = {}, messages = [];
      const ws = { readyState: 1, on(t, fn) { handlers[t] = fn; }, send(raw) { messages.push(JSON.parse(raw)); }, close() { this.readyState = 2; } };
      connection(ws, { url: '/ws?room=testroom' });
      return { ws, messages, send: msg => handlers.message(JSON.stringify(msg)), raw: raw => handlers.message(raw), lobby: () => messages.filter(m => m.t === 'lobby').at(-1) };
    },
  };
};
const settleServer = () => new Promise(resolve => setImmediate(resolve));

// Server: repeated hello messages must not race initialization or close their own connection.
{
  const h = serverHarness(), p = h.connect(); h.holdMaps();
  const first = p.send({ t: 'hello', token: 'host', name: 'Host' });
  const again = p.send({ t: 'hello', token: 'host', name: 'Host' });
  h.releaseMaps(); await Promise.all([first, again]); await settleServer();
  assert.equal(p.ws.readyState, 1, 'server repeated hello keeps its connection open');
  assert.equal(p.lobby().players.length, 1, 'server repeated hello occupies one player slot');
}

// Server: a replaced or departed socket cannot keep controlling its old player slot.
{
  const h = serverHarness(), old = h.connect(), current = h.connect();
  await old.send({ t: 'hello', token: 'host', name: 'Old' });
  await current.send({ t: 'hello', token: 'host', name: 'Current' }); await settleServer();
  await old.send({ t: 'name', name: 'Stale' }); await settleServer();
  assert.equal(current.lobby().players[0].name, 'Current', 'server replaced socket cannot rename its former player');
  const guest = h.connect(); await guest.send({ t: 'hello', token: 'guest', name: 'Guest' });
  await current.send({ t: 'start' });
  const before = h.game().units.size;
  await current.send({ t: 'leave' });
  await current.send({ t: 'buy', unit: 'rifle' });
  assert.equal(h.game().units.size, before, 'server departed socket cannot buy for the AI that took over');
}

// Server: a map request still awaiting disk cannot change settings once the match has started.
for (const lookupFinished of [false, true]) {
  const h = serverHarness(), p = h.connect();
  await p.send({ t: 'hello', token: 'host', name: 'Host' }); h.holdMaps();
  const map = p.send({ t: 'map', name: 'other' });
  if (lookupFinished) await settleServer();
  const start = p.send({ t: 'start' }); await settleServer();
  h.releaseMaps(); await Promise.all([map, start]); await settleServer();
  assert.equal(p.lobby().mapName, 'default', `server pending map ${lookupFinished ? 'load' : 'lookup'} cannot change a started match`);
}

// Server: ending a match while its map loads must cancel that start.
{
  const h = serverHarness(), p = h.connect();
  await p.send({ t: 'hello', token: 'host', name: 'Host' }); h.holdMaps();
  const start = p.send({ t: 'start' });
  await p.send({ t: 'end' });
  h.releaseMaps(); await start; await settleServer();
  assert.equal(p.messages.filter(m => m.t === 'start').length, 0, 'server cancelled start never sends players back into play');
  assert.equal(p.lobby().state, 'lobby', 'server cancelled start keeps the lobby open');
  assert.deepEqual(p.lobby().result, { ended: true }, 'server cancelled start preserves the host end result');
}

// Server: player-slot commands require numeric integer slots, without string or array coercion.
{
  const h = serverHarness(), p = h.connect();
  await p.send({ t: 'hello', token: 'host', name: 'Host' });
  await p.send({ t: 'addAi' }); await settleServer();
  for (const slot of ['1', [1], 1.5, -1, null, true]) {
    await p.send({ t: 'faction', slot, v: 2 }); await settleServer();
    assert.equal(p.lobby().players[1].faction, 1, 'server malformed faction slot is ignored');
    await p.send({ t: 'team', slot, v: 4 }); await settleServer();
    assert.equal(p.lobby().players[1].team, 1, 'server malformed team slot is ignored');
    await p.send({ t: 'kick', slot }); await settleServer();
    assert.equal(p.lobby().players.length, 2, 'server malformed kick slot is ignored');
  }
  await p.send({ t: 'faction', slot: 1, v: 2 }); await settleServer();
  assert.equal(p.lobby().players[1].faction, 2, 'server valid integer faction slot still works');
  await p.send({ t: 'kick', slot: 1 }); await settleServer();
  assert.equal(p.lobby().players.length, 1, 'server valid integer kick slot still works');
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

// Server: JSON objects masquerading as names or tokens cannot crash text conversion.
{
  const h = serverHarness(), p = h.connect(), invalid = { toString: null, valueOf: null };
  for (const field of ['token', 'name']) {
    await assert.doesNotReject(() => p.send({ t: 'hello', token: 'host', name: 'Host', [field]: invalid }), `server malformed hello ${field} does not throw`);
    await settleServer(); assert.equal(p.messages.length, 0, 'server malformed hello text does not claim a player slot');
  }
  await p.send({ t: 'hello', token: 'host', name: 'Host' }); await settleServer();
  await assert.doesNotReject(() => p.send({ t: 'name', name: invalid }), 'server malformed rename does not throw');
  await settleServer(); assert.equal(p.lobby().players[0].name, 'Host', 'server malformed rename preserves the player name');
}

// Server: Massive rooms construct snapshots only for sockets that can receive them.
{
  const map = { w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [5, 75].flatMap(y => [5, 40, 75].map(x => ({ x, y }))), points: [{ x: 40, y: 40 }] };
  const h = serverHarness(JSON.stringify(map)), p = h.connect();
  await p.send({ t: 'hello', token: 'host', name: 'Host' });
  for (let i = 0; i < 5; i++) await p.send({ t: 'addAi' });
  await p.send({ t: 'army', v: 'massive' }); await p.send({ t: 'start' });
  for (let slot = 0; slot < 6; slot++) {
    h.game().players[slot].mp = 50000;
    for (let i = 0; i < 42; i++) command(h.game(), slot, { t: 'buy', unit: 'rifle' });
  }
  assert.equal(h.game().units.size, 270, 'server snapshot fixture fields 270 units');
  h.tick(); h.tick();
  assert.equal(h.snapshots(), 1, 'server constructs one snapshot for one connected human and five AIs');
  p.ws.readyState = 2; h.tick(); h.tick();
  assert.equal(h.snapshots(), 1, 'server constructs no snapshot for a socket that is closing');
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
  const h = serverHarness(JSON.stringify(map)), p = h.connect(), guest = h.connect();
  await p.send({ t: 'hello', token: 'host', name: 'Host' }); await guest.send({ t: 'hello', token: 'guest', name: 'Guest' });
  await p.send({ t: 'mode', v: 'classic' }); await p.send({ t: 'start' });
  const enemyHq = [...h.game().units.values()].find(u => u.owner === 1 && u.type === 'hq');
  assert.ok(!p.messages.find(m => m.t === 'start').cells.some(([c]) => enemyHq.cells.includes(c)), 'server initial terrain excludes unseen enemy HQ footprints');
  const returning = h.connect(); await returning.send({ t: 'hello', token: 'host', name: 'Host' });
  assert.ok(!returning.messages.find(m => m.t === 'start').cells.some(([c]) => enemyHq.cells.includes(c)), 'server reconnect terrain excludes unseen enemy HQ footprints');
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

// Fixed Massive fixture for exact comparisons and repeatable subsystem timings.
const massiveInternals = await import('data:text/javascript;base64,' + Buffer.from(readFileSync('shared/sim.js', 'utf8')
  + '\nexport { updateVision, nearCover, behindCover, aimPoint, flagsAt, dist, spawnUnit, placeBuilding, wreckBuilding, setCell, logCell };').toString('base64'));
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
  const old = await import('data:text/javascript;base64,' + Buffer.from(source.slice(0, start) + referenceSeparation + source.slice(end)).toString('base64'));
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
    tank.x = x; tank.hp = 0;
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
}
console.log('all sim checks passed');
