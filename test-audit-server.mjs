import assert from 'node:assert/strict';
import WebSocket from 'ws';

Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://test', EDIT_PASSWORD: 'test' });
const service = await import('./server.js');
clearInterval(service.loop);
service.clock.setTimeout = () => null;
if (!service.server.listening) await new Promise(resolve => service.server.once('listening', resolve));
const map = { name: 'Audit plain', w: 80, h: 80, rows: Array(80).fill('.'.repeat(80)), spawns: [{ x: 10, y: 10 }, { x: 70, y: 70 }], points: [{ x: 40, y: 40 }] };
const hordeMap = { ...map, name: 'Audit horde', spawns: [...map.spawns, { x: 10, y: 70 }], defend: [0] };
const originalMaps = { ...service.mapFiles }, sockets = [];
const wait = async (predicate, label) => {
  const until = Date.now() + 10000;
  while (!predicate()) { assert.ok(Date.now() < until, label); await new Promise(resolve => setTimeout(resolve, 5)); }
};
let release = () => {};
try {
  for (const action of ['start', 'newer-mode', 'complete']) {
    let selectedRead = false, reads = 0, returned = false;
    const gate = new Promise(resolve => { release = resolve; });
    service.mapFiles.list = async () => ['default.json', 'audit-horde.json'];
    service.mapFiles.read = async name => {
      if (name === 'audit-horde') {
        if (++reads === 2) { selectedRead = true; await gate; returned = true; }
        return JSON.stringify(hordeMap);
      }
      return JSON.stringify(map);
    };
    const name = `auditrace${sockets.length}`, messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${service.server.address().port}/ws?room=${name}`, { perMessageDeflate: false });
    sockets.push(ws); ws.on('message', data => messages.push(JSON.parse(data)));
    await new Promise(resolve => ws.once('open', resolve));
    ws.send(JSON.stringify({ t: 'hello', token: name, name: 'Audit' }));
    await wait(() => messages.some(m => m.t === 'lobby'), 'lobby received');
    const room = service.rooms.get(name), initialMap = room.mapName;
    ws.send(JSON.stringify({ t: 'mode', v: 'horde' }));
    await wait(() => selectedRead, 'Horde selection awaits its map');
    assert.equal(room.mode, 'conquest');
    assert.equal(room.mapName, initialMap, 'pending loading does not partially change room settings');
    if (action === 'start') {
      ws.send(JSON.stringify({ t: 'start' }));
      await wait(() => messages.some(m => m.t === 'start'), 'match started');
    } else if (action === 'newer-mode') {
      ws.send(JSON.stringify({ t: 'mode', v: 'classic' }));
      await wait(() => room.mode === 'classic', 'newer mode selection applied');
    }
    release(); await wait(() => returned, 'pending read released');
    await new Promise(resolve => setImmediate(resolve));
    if (action === 'complete') {
      await wait(() => room.mode === 'horde', 'completed selection applied');
      assert.equal(room.mapName, 'audit-horde');
      assert.deepEqual(room.mapSpawns, hordeMap.spawns);
    } else {
      assert.equal(room.mode, action === 'start' ? 'conquest' : 'classic', 'stale selection cannot overwrite current mode');
      assert.equal(room.mapName, initialMap, 'stale selection cannot overwrite current map');
      if (action === 'start') {
        assert.equal(room.game.mode?.kind ?? 'conquest', 'conquest');
        const before = messages.length;
        ws.send(JSON.stringify({ t: 'move', orders: [null] }));
        ws.send(JSON.stringify({ t: 'ping', c: 'after-invalid-order' }));
        await wait(() => messages.slice(before).some(m => m.t === 'pong' && m.c === 'after-invalid-order'), 'server survives malformed orders');
        assert.equal(room.state, 'play');
      }
    }
    ws.terminate(); service.rooms.delete(name);
  }
  console.log('OK audit server: atomic Horde selection, stale load rejection and malformed socket command survival');
} finally {
  release(); Object.assign(service.mapFiles, originalMaps);
  for (const ws of sockets) ws.terminate();
  for (const ws of service.wss.clients) ws.terminate();
  service.rooms.clear();
  await new Promise(resolve => service.wss.close(resolve));
  await new Promise(resolve => service.server.close(resolve));
}
