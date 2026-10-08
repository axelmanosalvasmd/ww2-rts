import { sendsReadBy } from './test-socket.js';
// Team, defeat, discovery and AI acceptance through real room WebSocket messages.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
const sendRead = sendsReadBy(server.wss);
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], settle = () => new Promise(resolve => setTimeout(resolve, 12));
async function waitFor(fn, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(code, token, spectate = false) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${code}`, { perMessageDeflate: false });
  const messages = [], rows = new Map();
  const client = {
    ws, messages, latest: t => messages.filter(m => m.t === t).at(-1),
    async send(msg) { await sendRead(ws, msg); await settle(); },
    wait: (t, after = 0) => waitFor(() => messages.slice(after).find(m => m.t === t), `missing ${t}`),
  };
  clients.push(client);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'start') rows.clear();
    if (m.t === 's') {
      if (m.all) rows.clear();
      for (const id of m.gone ?? []) rows.delete(id);
      for (const row of m.units) rows.set(row[0], row);
      m.units = [...rows.values()];
    }
    messages.push(m);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token, spectate });
  await client.wait('lobby');
  return client;
}
async function tick(n = 2) {
  for (let i = 0; i < n; i++) server.tickRooms();
  await settle();
}
try {
  const host = await connect('worldteams', 'host');
  const ally = await connect('worldteams', 'ally');
  const rival = await connect('worldteams', 'rival');
  await host.send({ t: 'team', slot: 1, v: 0 });
  await host.send({ t: 'team', slot: 2, v: 1 });
  await host.send({ t: 'mode', v: 'world' });
  await host.send({ t: 'worldSize', v: 'massive' });
  await host.send({ t: 'start' });
  const start = await host.wait('start'), allyStart = await ally.wait('start'), rivalStart = await rival.wait('start');
  assert.equal(start.map.world.total, 128, 'Massive contains 128 regions');
  assert.deepEqual([start.map.w, start.map.h], [1024, 512], 'Massive spans 2,048 by 1,024 metres');
  assert.ok(start.spawns[1] && allyStart.spawns[0], 'teammates know allied spawn locations');
  assert.equal(start.spawns[2], null, 'allied team does not receive the rival spawn');
  assert.equal(rivalStart.spawns[0], null, 'rival does not receive allied spawns');
  assert.equal(rivalStart.spawns[1], null);
  await tick();
  assert.equal(host.latest('s').world.owned, 2, 'both home regions belong to the allied team');
  assert.equal(ally.latest('s').world.owned, 2, 'teammates receive the same territory count');
  assert.equal(rival.latest('s').world.owned, 1, 'the rival retains its own home');

  const watch = await connect('worldteams', 'watch', true), watchStart = await watch.wait('start');
  assert.equal(watchStart.spawns[2], null, 'spectators follow one team without revealing enemy homes');
  assert.ok(watchStart.fog, 'World Conquest spectators retain fog');
  const g = server.rooms.get('worldteams').game;
  const before = new Set(host.latest('s').world.regions.map(r => r.id));
  const unknown = g.world.regions.find(r => r.team < 0 && !before.has(r.id));
  assert.ok(unknown, 'fixture has a region unknown to the allied team');
  const scout = [...g.units.values()].find(u => u.owner === 1 && u.type === 'rifle');
  // Move one ally to an unknown region. Assertions inspect only the resulting delivered views.
  Object.assign(scout, { x: unknown.x, z: unknown.z, path: [], targetId: 0, attackId: 0 });
  await tick(8);
  assert.ok(host.latest('s').world.regions.some(r => r.id === unknown.id), 'ally scouting reveals regional information to host');
  assert.ok(ally.latest('s').world.regions.some(r => r.id === unknown.id), 'scout receives the same discovered region');
  assert.ok(watch.latest('s').world.regions.some(r => r.id === unknown.id), 'team spectator shares that discovery');
  assert.ok(!rival.latest('s').world.regions.some(r => r.id === unknown.id), 'rival receives no remote scouting disclosure');
  const knownAfter = host.latest('s').world.regions.length;
  Object.assign(scout, { ...g.players[1].spawn, path: [], targetId: 0, attackId: 0 });
  await tick(8);
  assert.ok(host.latest('s').world.regions.length >= knownAfter, 'discovered regions remain remembered after the scout leaves');

  const originalHQ = [...g.units.values()].find(u => u.owner === 0 && u.type === 'hq');
  originalHQ.hp = 0;
  await tick(4);
  assert.equal(host.latest('s').out[0], false, 'original HQ loss does not defeat a nation with shared territory');
  assert.equal(host.latest('s').out[1], false, 'the allied nation remains active');
  for (const r of g.world.regions) if (r.team === 0) { r.team = 1; r.progress = 1; }
  await tick(4);
  assert.equal(host.latest('s').out[0], true, 'loss of the last team region defeats the first teammate');
  assert.equal(ally.latest('s').out[1], true, 'loss of the last team region defeats both teammates');
  assert.equal(rival.latest('s').winner, null, 'defeating rival nations does not skip unclaimed territory');
  for (const r of g.world.regions) { r.team = 1; r.progress = 1; }
  await tick(4);
  await waitFor(() => rival.latest('s')?.winner === 1, 'total-conquest result reaches the rival client');
  assert.equal(rival.latest('s').winner, 1, 'owning every region produces the territorial winner');
  assert.equal(rival.latest('s').world.owned, 128, 'victory snapshot reports the whole continent');
  assert.equal(rival.latest('s').end.reason, 'world', 'result records total conquest');

  // The completed Massive room has already proved its result. Keep its full-map
  // victory snapshots out of the separate active-room AI timing fixture.
  server.rooms.delete('worldteams');
  const aiHost = await connect('worldai', 'observer');
  await aiHost.send({ t: 'mode', v: 'world' });
  await aiHost.send({ t: 'addAi' });
  await aiHost.send({ t: 'team', slot: 1, v: 0 });
  await aiHost.send({ t: 'start' });
  await aiHost.wait('start');
  await tick();
  const aiRifle = aiHost.latest('s').units.find(r => r[2] === 1 && r[1] === 'rifle');
  assert.ok(aiRifle, 'human teammate receives the AI nation starting Rifle Squad');
  const initial = aiRifle.slice(3, 5), began = Date.now();
  let moved = false;
  for (let i = 0; i < 15; i++) {
    await tick(20);
    const rifle = aiHost.latest('s').units.find(r => r[0] === aiRifle[0]);
    moved ||= !!rifle && Math.hypot(rifle[3] - initial[0], rifle[4] - initial[1]) > 3;
  }
  assert.ok(moved, 'lobby AI scouts remembered frontiers through ordinary movement');
  assert.equal(aiHost.latest('s').winner, null, 'early AI exploration cannot award premature total conquest');
  console.log(`World team, discovery, defeat, victory and 300 AI ticks passed (${Date.now() - began} ms AI fixture)`);
} finally {
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
