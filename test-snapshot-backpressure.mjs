// A socket that cannot keep up skips snapshots, then gets one fresh snapshot once its backlog is written.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const settle = () => new Promise(resolve => setTimeout(resolve, 8));
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=backlog`, { perMessageDeflate: true });
const messages = [], latest = t => messages.filter(m => m.t === t).at(-1), send = async m => { ws.send(JSON.stringify(m)); await settle(); };
ws.on('message', data => messages.push(JSON.parse(data)));
try {
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await send({ t: 'hello', token: 'host', name: 'host' });
  await send({ t: 'addAi' });
  await send({ t: 'start' });
  await until(() => latest('start'), 'the match starts');
  const room = server.rooms.get('backlog'), g = room.game, seat = room.players[0].ws, CAP = 256 * 1024;
  for (let i = 0; i < 4; i++) server.tickRooms();
  await until(() => latest('s') && !seat.inflight, 'snapshots flow');

  // Just under the cap: the next snapshot goes out and tips it over, so a later one in the same burst is skipped.
  seat.inflight = CAP - 1;
  for (let i = 0; i < 12 && !seat.owed; i++) server.tickRooms();
  assert.ok(seat.owed, 'a backed-up socket skips a snapshot');
  const skippedAt = g.tick, sentBefore = messages.filter(m => m.t === 's').length;
  await until(() => !seat.owed && latest('s')?.tick === skippedAt, 'the skipped seat gets a fresh snapshot once its backlog is written');
  assert.equal(messages.filter(m => m.t === 's').length, sentBefore + 2, 'one queued snapshot, then one catch-up');
  seat.inflight -= CAP - 1;
  assert.equal(seat.inflight, 0, 'every written snapshot is counted off');
  console.log('PASS snapshot backpressure: skipped while backed up, one fresh snapshot after');
} finally {
  ws.close();
  server.server.close();
  process.exit(process.exitCode ?? 0);
}
