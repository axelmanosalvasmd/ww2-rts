// Real sockets prove AI diagnostics and local human telemetry cross no seat boundary.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const recorderEnabled = !process.argv.includes('--disabled');
if (recorderEnabled) execFileSync(process.execPath, [import.meta.filename, '--disabled'], { stdio: 'inherit', timeout: 30000 });
const dir = await mkdtemp(join(tmpdir(), 'ww2-recorder-engine-'));
Object.assign(process.env, { PORT: '0', PUBLIC_URL: 'http://test', WW2_HUMAN_INPUT: recorderEnabled ? '1' : '0', WW2_HUMAN_INPUT_DIR: dir });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], settle = () => new Promise(resolve => setTimeout(resolve, 10));
async function waitFor(fn) {
  for (let i = 0; i < 500; i++) { const result = fn(); if (result) return result; await settle(); }
  assert.fail('missing WebSocket message');
}
async function connect(token, { humanInput = false, spectate = false, room = 'handstest' } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${room}`, { perMessageDeflate: false });
  const messages = [], client = { ws, messages, latest: kind => messages.filter(m => m.t === kind).at(-1),
    async send(msg) { ws.send(JSON.stringify(msg)); await settle(); } };
  clients.push(client); ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token, humanInput, spectate });
  await waitFor(() => client.latest('lobby'));
  return client;
}
const telemetry = { t: 'humanInput', kind: 'click', camera: { x: 20, z: 20, w: 80, h: 60 }, cursor: { x: 30, z: 35 }, selected: 1, token: 'private-metadata', units: ['hidden-state'] };
try {
  if (!recorderEnabled) {
    const host = await connect('disabled-recording', { humanInput: true });
    await host.send({ t: 'addAi' }); await host.send({ t: 'start' });
    await waitFor(() => host.latest('start'));
    assert.equal(Object.hasOwn(host.latest('start'), 'humanInput'), false, 'client query cannot enable the server recorder');
    await host.send(telemetry); await host.send({ t: 'stop', ids: [] });
    assert.equal(server.humanRecorder, null);
    assert.deepEqual(await readdir(dir), [], 'default server records nothing even if a client requests it');
  } else {
    const host = await connect('recorded', { humanInput: true }), rival = await connect('unrecorded');
    await host.send({ t: 'addAi' }); await host.send({ t: 'mode', v: 'classic' }); await host.send({ t: 'start' });
    await waitFor(() => host.latest('start'));
    const watcher = await connect('watcher', { humanInput: true, spectate: true });
    await waitFor(() => watcher.latest('start'));
    assert.equal(host.latest('start').humanInput, true, 'server and browser must both opt in');
    assert.equal(!!rival.latest('start').humanInput, false);
    assert.equal(!!watcher.latest('start').humanInput, false, 'spectators do not record a human seat');
    await host.send(telemetry); await rival.send(telemetry); await watcher.send(telemetry);
    const room = server.rooms.get('handstest'), hq = [...room.game.units.values()].find(unit => unit.owner === 0 && unit.type === 'hq');
    await host.send({ t: 'buy', unit: 'rifle', from: hq.id });
    await rival.send({ t: 'stop', ids: [] });
    for (let i = 0; i < 4; i++) server.tickRooms();
    await waitFor(() => watcher.latest('s'));
    assert.equal(Object.hasOwn(host.latest('s'), 'aiHands'), false, 'playing seat gets no AI camera');
    assert.equal(Object.hasOwn(rival.latest('s'), 'aiHands'), false, 'other seat gets no AI camera');
    const diagnostic = watcher.latest('s').aiHands;
    assert.ok(diagnostic?.some(row => row.slot === 2), 'full-map spectator receives the AI camera');
    for (const row of diagnostic) for (const key of ['ids', 'selectedIds', 'orders', 'command', 'persona', 'mp']) assert.equal(Object.hasOwn(row, key), false, `spectator receives no ${key}`);
    for (const client of clients) assert.equal(client.messages.some(msg => msg.t === 'humanInput' || Object.hasOwn(msg, 'cursor') || JSON.stringify(msg).includes('private-metadata')), false, 'human telemetry is never relayed');
    await server.humanRecorder.flush();
    const files = await readdir(dir);
    assert.equal(files.length, 1, 'only opted-in human has a local log');
    const rows = (await readFile(join(dir, files[0]), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(rows.every(row => row.slot === 0));
    assert.ok(rows.some(row => row.kind === 'click'));
    assert.ok(rows.some(row => row.command?.t === 'buy'));
    assert.equal(JSON.stringify(rows).includes('hidden-state'), false);
    assert.equal(JSON.stringify(rows).includes('private-metadata'), false);

    const worldHost = await connect('world-host', { room: 'handsworld' });
    await worldHost.send({ t: 'addAi' }); await worldHost.send({ t: 'mode', v: 'world' }); await worldHost.send({ t: 'start' });
    await waitFor(() => worldHost.latest('start'));
    const worldWatcher = await connect('world-watcher', { room: 'handsworld', spectate: true });
    await waitFor(() => worldWatcher.latest('start'));
    for (let i = 0; i < 4; i++) server.tickRooms();
    await waitFor(() => worldWatcher.latest('s'));
    assert.equal(Object.hasOwn(worldWatcher.latest('s'), 'aiHands'), false, 'shared-fog spectator receives no AI cameras');
  }
} finally {
  await server.humanRecorder?.flush();
  server.clock.setTimeout = () => null;
  for (const client of clients) client.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
console.log(recorderEnabled ? 'AI spectator diagnostics and opt-in human telemetry privacy passed over WebSocket' : 'Disabled server refuses human recording requests over WebSocket');
