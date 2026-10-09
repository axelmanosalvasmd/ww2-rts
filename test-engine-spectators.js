import { memoryConnect, sendsReadBy } from './test-socket.js';
// Real room snapshots keep authored recipient policies and owner-only work off spectator sockets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import WebSocket from 'ws';
import { migrateWorldMap } from './shared/world-layers.js';
import { validateMap } from './shared/sim.js';

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
const sendRead = sendsReadBy(server.wss);
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));

const map = migrateWorldMap(JSON.parse(readFileSync(new URL('./maps/default.json', import.meta.url), 'utf8')));
map.points[0].id = 'point:7';
map.pointSequence = 8;
const replace = (row, x, value) => row.slice(0, x) + value + row.slice(x + 1);
map.rows[5] = replace(map.rows[5], 5, 'N');
map.layers.ground[5] = replace(map.layers.ground[5], 5, 'D');
map.layers.objects[5] = replace(map.layers.objects[5], 5, 'N');
map.rows[5] = replace(map.rows[5], 6, 'N');
map.layers.objects[5] = replace(map.layers.objects[5], 6, 'R');
map.layers.mines = Array(map.h).fill('.'.repeat(map.w));
map.layers.mines[5] = replace(map.layers.mines[5], 6, 'N');
map.layers.groundMaterials = [{ c: 5 * map.w + 5, material: 'road' }];
map.layers.objectMaterials = [{ c: 5 * map.w + 5, material: 'steel' }, { c: 5 * map.w + 6, material: 'stone' }];
map.layers.mineMaterials = [{ c: 5 * map.w + 6, material: 'steel' }];
const house = map.rows.join('').indexOf('B');
assert.ok(house >= 0);
map.structures = [{ id: 'safehouse', kind: 'house', sections: [{ id: 'corner', c: house, hp: 100, material: 'wood', anchor: true, supports: [] }] }];
map.scenario = {
  version: 1, areas: [], groups: [],
  objectives: [
    { id: 'everyone', text: { en: 'Public objective' }, recipients: 'public' },
    { id: 'seat', text: { en: 'Seat objective' }, recipients: 'side', side: 0 },
    { id: 'allies', text: { en: 'Team objective' }, recipients: 'team', side: 0 },
  ],
  triggers: [{ id: 'start', scope: 'match', recipients: 'public', side: 0,
    condition: { kind: 'time', seconds: 0 }, repeat: { mode: 'once' }, actions: [
      { kind: 'objectiveActivate', objective: 'everyone' },
      { kind: 'objectiveActivate', objective: 'seat' },
      { kind: 'objectiveActivate', objective: 'allies' },
      { kind: 'say', text: { en: 'Public message' }, recipients: 'public' },
      { kind: 'say', text: { en: 'Seat message' }, recipients: 'side', side: 0 },
      { kind: 'say', text: { en: 'Team message' }, recipients: 'team', side: 0 },
    ] }],
};
const originalRead = server.mapFiles.read;
let servedMap = map;
server.mapFiles.read = name => name === 'default' ? JSON.stringify(servedMap) : originalRead(name);
const clients = [], settle = () => new Promise(resolve => setTimeout(resolve, 15));
const base = `http://127.0.0.1:${server.server.address().port}`;
async function waitFor(fn) {
  for (let n = 0; n < 500; n++) { const result = fn(); if (result) return result; await settle(); }
  assert.fail('missing WebSocket message');
}
async function connect(token, spectate = false, code = 'spectest') {
  const ws = memoryConnect(server.wss, `/ws?room=${code}`);
  const messages = [], c = { ws, messages, latest: kind => messages.filter(m => m.t === kind).at(-1), async send(m) { await sendRead(ws, m); await settle(); } };
  clients.push(c);
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await c.send({ t: 'hello', name: token, token, spectate });
  await waitFor(() => c.latest('lobby'));
  return c;
}
try {
  assert.equal(validateMap(map), null);
  const publicMap = await (await fetch(`${base}/maps/default.json`)).json();
  assert.equal(publicMap.scenario, undefined);
  assert.equal(publicMap.triggers, undefined);
  assert.deepEqual([publicMap.rows[5][5], publicMap.layers.ground[5][5], publicMap.layers.objects[5][5]], ['D', 'D', '.']);
  assert.deepEqual([publicMap.rows[5][6], publicMap.layers.objects[5][6], publicMap.layers.mines[5][6]], ['R', 'R', '.']);
  assert.deepEqual(publicMap.layers.groundMaterials, map.layers.groundMaterials);
  assert.deepEqual(publicMap.layers.objectMaterials, [{ c: 5 * map.w + 6, material: 'stone' }]);
  assert.deepEqual(publicMap.layers.mineMaterials, []);
  const rawResponse = await fetch(`${base}/maps/default.json`, { headers: { 'x-edit-password': 'test' } });
  assert.equal(rawResponse.status, 200);
  const rawMap = await rawResponse.json();
  assert.equal(rawMap.rows[5][5], 'N');
  assert.equal(rawMap.layers.objects[5][5], 'N');
  assert.deepEqual([rawMap.layers.objects[5][6], rawMap.layers.mines[5][6]], ['R', 'N']);
  assert.equal(rawMap.scenario.triggers[0].id, 'start');
  const wrong = await fetch(`${base}/maps/default.json`, { headers: { 'x-edit-password': 'wrong' } });
  assert.equal(wrong.status, 403);
  const name = 'test-scenario-private';
  const saved = await fetch(`${base}/maps/${name}.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': 'test' }, body: JSON.stringify(map) });
  assert.equal(saved.status, 200, await saved.text());
  const savedRaw = await (await fetch(`${base}/maps/${name}.json`, { headers: { 'x-edit-password': 'test' } })).json();
  assert.deepEqual(savedRaw.layers, map.layers);
  assert.deepEqual(savedRaw.structures, map.structures);
  assert.deepEqual(savedRaw.scenario, map.scenario);
  assert.deepEqual(savedRaw.points.map(p => p.id), map.points.map(p => p.id));
  assert.equal(savedRaw.pointSequence, 8);
  assert.equal((await (await fetch(`${base}/maps/${name}.json`)).json()).scenario, undefined);
  const host = await connect('host'), rival = await connect('rival');
  await host.send({ t: 'mode', v: 'classic' });
  await host.send({ t: 'start' });
  await waitFor(() => host.latest('start'));
  const watcher = await connect('watcher', true);
  await waitFor(() => watcher.latest('start'));
  const g = server.rooms.get('spectest').game;
  const hq = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  assert.ok(hq);
  await host.send({ t: 'buy', unit: 'rifle', from: hq.id });
  await host.send({ t: 'buy', unit: 'rifle', from: hq.id });
  for (let i = 0; i < 2; i++) server.tickRooms();
  const own = await waitFor(() => host.latest('s'));
  const enemy = await waitFor(() => rival.latest('s'));
  const seen = await waitFor(() => watcher.latest('s'));
  assert.deepEqual(own.scenario.objectives.map(o => o.id), ['everyone', 'seat', 'allies']);
  assert.deepEqual(enemy.scenario.objectives.map(o => o.id), ['everyone']);
  assert.deepEqual(seen.scenario.objectives.map(o => o.id), ['everyone']);
  assert.deepEqual(own.shots.filter(s => s.k === 'say').map(s => s.text), ['Public message', 'Seat message', 'Team message']);
  assert.deepEqual(enemy.shots.filter(s => s.k === 'say').map(s => s.text), ['Public message']);
  assert.deepEqual(seen.shots.filter(s => s.k === 'say').map(s => s.text), ['Public message']);
  assert.equal(own.productionJobs.find(row => row[0] === hq.id)[1].length, 2);
  for (const key of ['movement', 'queues', 'productionJobs', 'plans', 'orders', 'air', 'mp', 'inc', 'mun', 'fuel', 'fuelInc', 'upkeep', 'sup', 'rally', 'home', 'works', 'covers']) assert.equal(Object.hasOwn(seen, key), false, `spectator cannot read owner ${key}`);
  for (const row of seen.units.filter(row => row[2] === 0)) {
    assert.equal(row[11], 0, 'spectator cannot read owner cooldown');
    assert.equal(row[12] & (2048 | 4096 | 8192 | 16384), 0, 'spectator cannot read owner stance settings');
  }
  const reconnect = await connect('watcher', true);
  await waitFor(() => reconnect.latest('start'));
  for (let i = 0; i < 2; i++) server.tickRooms();
  const restored = await waitFor(() => reconnect.latest('s'));
  assert.deepEqual(restored.scenario.objectives.map(o => o.id), ['everyone']);
  assert.equal(restored.shots.some(s => s.k === 'say'), false, 'reconnect does not replay an old announcement');
  const invalid = structuredClone(map);
  invalid.structures[0].sections[0].supports = ['missing'];
  assert.match(validateMap(invalid), /support/);
  servedMap = invalid;
  const badHost = await connect('bad-host', false, 'badmap');
  await badHost.send({ t: 'start' });
  const denied = await waitFor(() => badHost.latest('deny'));
  assert.deepEqual([denied.cmd, denied.reason], ['start', 'scenario']);
  assert.equal(server.rooms.get('badmap').game, null);
  assert.equal(server.rooms.get('badmap').matchId, 0);
  assert.equal(server.rooms.get('badmap').state, 'lobby', 'invalid authored map cannot silently start the default map');
  const unknownEffect = structuredClone(map);
  unknownEffect.scenario.triggers[0].actions[0].kind = 'arbitraryCode';
  const invalidSave = await fetch(`${base}/maps/${name}.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': 'test' }, body: JSON.stringify(unknownEffect) });
  assert.equal(invalidSave.status, 400);
  assert.match((await invalidSave.json()).error, /unknown action/);
  const staleSequence = structuredClone(map);
  staleSequence.pointSequence = 7;
  const staleSave = await fetch(`${base}/maps/${name}.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': 'test' }, body: JSON.stringify(staleSequence) });
  assert.equal(staleSave.status, 400);
  assert.match((await staleSave.json()).error, /pointSequence/);
  const empty = '.'.repeat(1024);
  const largeRows = Array(1024).fill(empty);
  const largeMap = { name: 'Largest authored layers', w: 1024, h: 1024, rows: largeRows,
    worldVersion: 2, layers: { ground: largeRows, objects: largeRows, mines: largeRows },
    spawns: [{ x: 10, y: 10 }, { x: 1010, y: 1010 }], points: [{ id: 'point:0', x: 512, y: 512 }], pointSequence: 1 };
  const largeName = 'test-large-v2';
  assert.equal(validateMap(largeMap), null);
  const largeSave = await fetch(`${base}/maps/${largeName}.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': 'test' }, body: JSON.stringify(largeMap) });
  assert.equal(largeSave.status, 200, await largeSave.text());
  const largeSaved = await (await fetch(`${base}/maps/${largeName}.json`, { headers: { 'x-edit-password': 'test' } })).json();
  assert.deepEqual(largeSaved.layers, largeMap.layers);
  assert.equal(largeSaved.pointSequence, 1);
  const overLimit = await fetch(`${base}/maps/${largeName}.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edit-password': 'test' }, body: Buffer.alloc(8 * 1024 * 1024 + 1, 32) });
  assert.equal(overLimit.status, 413);
} finally {
  server.mapFiles.read = originalRead;
  await unlink(new URL('./maps/test-scenario-private.json', import.meta.url)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await unlink(new URL('./maps/test-large-v2.json', import.meta.url)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
console.log('Spectator recipient, map source privacy and authored start checks passed over HTTP and WebSocket');
