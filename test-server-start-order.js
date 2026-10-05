// Hold the real final map-list read so startup ordering cannot depend on disk timing.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const directory = await mkdtemp(join(tmpdir(), 'ww2-start-order-'));
Object.assign(process.env, { PORT: '0', PUBLIC_URL: 'http://test', WW2_HUMAN_INPUT: '1', WW2_HUMAN_INPUT_DIR: directory });
const service = await import('./server.js');
clearInterval(service.loop);
if (!service.server.listening) await new Promise(resolve => service.server.once('listening', resolve));
service.clock.setTimeout = () => null;
const originalRead = service.mapFiles.read, originalList = service.mapFiles.list, clients = [];
const mapName = 'start-order-test';
const map = { name: 'Start ordering', w: 24, h: 24, rows: Array(24).fill('.'.repeat(24)),
  spawns: [{ x: 2, y: 2 }, { x: 21, y: 21 }], points: [{ x: 12, y: 12 }] };
let invalid = false, room, gate = null;
service.mapFiles.read = name => name === mapName ? Promise.resolve(invalid ? 'invalid JSON' : JSON.stringify(map)) : originalRead(name);
service.mapFiles.list = async () => {
  // Map loading has finished and room.game is published. Only the final lobby read is held.
  if (gate && room?.starting && room.game) { gate.entered = true; await gate.promise; }
  return [...await originalList(), `${mapName}.json`];
};
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const value = predicate(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(token, spectate = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${service.server.address().port}/ws?room=startorder`, { perMessageDeflate: false });
  const messages = [], client = { ws, messages,
    async send(value) { ws.send(JSON.stringify(value)); await settle(); },
    wait: (type, after = 0) => until(() => messages.slice(after).find(message => message.t === type), `missing ${type}`) };
  clients.push(client);
  ws.on('message', data => messages.push(JSON.parse(data)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token, spectate, humanInput: token === 'host' });
  return client;
}
async function begin(client, type = 'start') {
  let release;
  gate = { entered: false, promise: new Promise(resolve => { release = resolve; }), release: () => release() };
  await client.send({ t: type });
  await until(() => gate.entered, 'final lobby map-list read was not reached');
}
async function finish() {
  const pending = gate; gate = null; pending.release();
  await until(() => !room.starting, 'successful start did not clear pending marker');
  await settle();
}
async function tick() { service.tickRooms(); service.tickRooms(); await settle(); }
function apply(rows, snapshot) {
  if (snapshot.all || !snapshot.held) rows.clear();
  for (const id of snapshot.gone ?? []) rows.delete(id);
  for (const row of snapshot.units) rows.set(row[0], row);
  assert.equal(rows.size, snapshot.held[0], 'delivered delta reconstructs advertised count');
  assert.equal([...rows.keys()].reduce((xor, id) => xor ^ id, 0), snapshot.held[1], 'delivered delta reconstructs advertised IDs');
}
function startsBeforeSnapshots(client, after = 0) {
  const messages = client.messages.slice(after), start = messages.findIndex(message => message.t === 'start');
  const snapshot = messages.findIndex(message => message.t === 's');
  assert.ok(start >= 0 && snapshot > start, 'setup must precede the first live snapshot');
  const playingLobby = messages.findIndex(message => message.t === 'lobby' && message.state === 'play');
  assert.ok(playingLobby >= 0 && playingLobby < start, 'playing lobby precedes initial setup');
}
async function recordings() {
  await service.humanRecorder.flush();
  const files = await readdir(directory);
  return (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8'))))
    .flatMap(contents => contents.trim() ? contents.trim().split('\n').map(JSON.parse) : []);
}
const telemetry = { t: 'humanInput', kind: 'click', camera: { x: 10, z: 10, w: 80, h: 60 }, cursor: { x: 12, z: 12 }, selected: 1 };
try {
  const host = await connect('host'), guest = await connect('guest'), watcher = await connect('watcher', true);
  await watcher.wait('lobby'); await host.send({ t: 'map', name: mapName });
  room = service.rooms.get('startorder');
  await until(() => room.mapName === mapName, 'test map selected');
  invalid = true; let rejectedIndex = host.messages.length;
  await host.send({ t: 'start' });
  assert.equal((await host.wait('deny', rejectedIndex)).reason, 'scenario');
  assert.equal(room.state, 'lobby'); assert.equal(room.game, null); assert.equal(room.starting, null); assert.equal(room.matchId, 0);
  assert.equal(host.messages.slice(rejectedIndex).some(message => message.t === 'start' || message.t === 's'), false, 'rejected initial setup publishes no world');
  invalid = false;
  const initialHost = host.messages.length, initialWatch = watcher.messages.length;
  await begin(host);
  const pendingGame = room.game, own = [...pendingGame.units.values()].filter(unit => unit.owner === 0);
  pendingGame.players[0].mp = 5000;
  const money = pendingGame.players[0].mp, count = pendingGame.units.size;
  await host.send({ t: 'buy', unit: 'rifle' });
  await host.send(telemetry); await tick();
  assert.equal(host.messages.slice(initialHost).some(message => message.t === 's'), false, 'held setup emits no human snapshot');
  assert.equal(watcher.messages.slice(initialWatch).some(message => message.t === 's'), false, 'held setup emits no watcher snapshot');
  assert.equal(pendingGame.tick, 0, 'published game stays unticked during setup');
  assert.equal(pendingGame.units.size, count, 'pending purchase creates no troop');
  assert.equal(pendingGame.players[0].mp, money, 'pending purchase spends no money');
  assert.deepEqual(await recordings(), [], 'pending physical input and command create no recorder row');

  // Keep the game published: a disconnect must retain the ordinary automatic pause.
  guest.ws.terminate(); await until(() => room.pause?.reason === 'drop', 'drop still automatically pauses pending game');
  assert.equal(room.pause.player.token, 'guest');
  const lateWatcher = await connect('late-watcher', true);
  await finish();
  await lateWatcher.wait('start');
  assert.equal(room.pause?.reason, 'drop', 'completing setup retains the disconnect pause');
  const returnedGuest = await connect('guest'); await returnedGuest.wait('start');
  await until(() => !room.pause, 'returning human resumes its disconnect pause');
  await host.send(telemetry);
  await host.send({ t: 'stop', ids: [own.find(unit => unit.type !== 'hq').id] });
  const recorded = await recordings();
  assert.ok(recorded.some(row => row.kind === 'click'), 'same input records after setup');
  assert.ok(recorded.some(row => row.command?.t === 'stop' && row.accepted), 'ordinary post-start command records and succeeds');
  assert.equal(recorded.some(row => row.command?.t === 'buy'), false, 'pending command never enters recorder');
  await tick();
  startsBeforeSnapshots(host, initialHost); startsBeforeSnapshots(watcher, initialWatch);
  // hello during pending setup may send setup immediately; it still cannot receive an earlier snapshot.
  assert.ok(lateWatcher.messages.findIndex(message => message.t === 'start') < lateWatcher.messages.findIndex(message => message.t === 's'));
  const hostRows = new Map(), watchRows = new Map();
  apply(hostRows, host.messages.slice(initialHost).find(message => message.t === 's'));
  apply(watchRows, watcher.messages.slice(initialWatch).find(message => message.t === 's'));
  assert.equal(hostRows.size, 3, 'human has only its fog-visible army');
  assert.equal(watchRows.size, 6, 'ordinary spectator has the public full-map army');
  assert.ok([...hostRows.keys()].every(id => pendingGame.units.get(id).owner === 0), 'no hidden enemy row crosses the human boundary');
  assert.ok(host.messages.slice(initialHost).find(message => message.t === 'start').fog, 'human setup carries private fog');
  assert.equal(Object.hasOwn(watcher.messages.slice(initialWatch).find(message => message.t === 'start'), 'fog'), false, 'ordinary watcher setup lifts fog');
  await tick(); const delta = host.messages.at(-1); apply(hostRows, delta);
  assert.equal(delta.units.length, 0, 'unchanged unit rows remain delta-compressed');
  let index = host.messages.length;
  await host.send({ t: 'resync' }); await tick();
  const full = host.messages.slice(index).find(message => message.t === 's'); assert.equal(full.all, true); apply(hostRows, full);
  const returningHost = await connect('host'); await returningHost.wait('start'); await tick();
  const reconnectSnapshot = await returningHost.wait('s'); apply(hostRows, reconnectSnapshot);
  assert.equal(hostRows.size, 3, 'reconnect preserves private fog');
  assert.ok(returningHost.messages.findIndex(message => message.t === 'start') < returningHost.messages.findIndex(message => message.t === 's'));

  const oldGame = room.game, oldMatch = room.matchId, altered = [...oldGame.units.values()].find(unit => unit.owner === 0);
  altered.hp = 50; await tick(); apply(hostRows, returningHost.messages.at(-1)); assert.equal(hostRows.get(altered.id)[7], 50);
  const oldTick = oldGame.tick; index = returningHost.messages.length;
  await begin(returningHost, 'restart'); await tick();
  assert.equal(room.game.tick, 0); assert.equal(oldGame.tick, oldTick, 'replacement setup cannot advance previous world');
  assert.equal(returningHost.messages.slice(index).some(message => message.t === 's'), false);
  await finish(); await tick();
  startsBeforeSnapshots(returningHost, index);
  assert.equal(room.matchId, oldMatch + 1); assert.notEqual(room.game, oldGame);
  const replacement = returningHost.messages.slice(index).find(message => message.t === 's'); apply(hostRows, replacement);
  assert.equal(hostRows.get(altered.id)[7], 100, 'recycled unit ID replaces old health on restart');
  assert.equal(watcher.messages.at(-1).all, true, 'existing spectator replaces its delta baseline');
  apply(watchRows, watcher.messages.at(-1)); assert.equal(watchRows.size, 6);

  const game = room.game, match = room.matchId;
  invalid = true; index = returningHost.messages.length; await returningHost.send({ t: 'restart' });
  assert.equal((await returningHost.wait('deny', index)).reason, 'scenario');
  assert.equal(room.game, game); assert.equal(room.matchId, match); assert.equal(room.starting, null);
  assert.equal(returningHost.messages.slice(index).some(message => message.t === 'start'), false);
  let priorTick = game.tick; await tick(); assert.equal(game.tick, priorTick + 2, 'rejected setup resumes prior game'); invalid = false;
  // Revalidate a saved Horde setting against the actual loaded map, which lacks defender spawns.
  room.mode = 'horde'; index = returningHost.messages.length; await returningHost.send({ t: 'restart' });
  await until(() => room.starting === null, 'Horde rollback clears pending marker');
  assert.equal(room.game, game); assert.equal(room.matchId, match);
  assert.equal(returningHost.messages.slice(index).some(message => message.t === 'start'), false);
  priorTick = game.tick; await tick(); assert.equal(game.tick, priorTick + 2, 'Horde rollback resumes prior game'); room.mode = 'conquest';
  index = returningHost.messages.length; await begin(returningHost, 'restart');
  await returningHost.send({ t: 'end' }); await until(() => room.state === 'lobby', 'host cancels pending setup');
  const pending = gate; gate = null; pending.release(); await settle(); await tick();
  assert.equal(room.game, null);
  assert.equal(returningHost.messages.slice(index).some(message => message.t === 'start' || message.t === 's'), false, 'cancelled continuation cannot resurrect a world');
  index = returningHost.messages.length; await begin(returningHost); await finish(); await tick();
  startsBeforeSnapshots(returningHost, index);
  assert.equal(room.starting, null, 'fresh start after cancellation completes normally');
  room.game.players[0].mp = 5000;
  const afterCancelMoney = room.game.players[0].mp, afterCancelCount = room.game.units.size;
  await returningHost.send({ t: 'buy', unit: 'rifle' });
  assert.equal(room.game.units.size, afterCancelCount + 1, 'the pending purchase is a legal ordinary post-start command');
  assert.ok(room.game.players[0].mp < afterCancelMoney, 'the legal purchase spends money after setup');
  assert.ok((await recordings()).some(row => row.command?.t === 'buy' && row.accepted), 'legal purchase is recorded only after setup');
  console.log('Server setup ordering, pending input, disconnect, fog, deltas and rollback checks passed');
} finally {
  gate?.release();
  service.mapFiles.read = originalRead; service.mapFiles.list = originalList;
  await service.humanRecorder?.flush();
  for (const client of clients) client.ws.terminate();
  for (const ws of service.wss.clients) ws.terminate();
  service.rooms.clear();
  await new Promise(resolve => service.wss.close(resolve));
  await new Promise(resolve => service.server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
