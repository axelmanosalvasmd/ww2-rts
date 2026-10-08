import { sendsReadBy } from './test-socket.js';
// World Conquest acceptance checks use the same WebSocket messages as the browser.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { UNITS } from './shared/sim.js';

Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
const sendRead = sendsReadBy(server.wss);
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 12));
async function waitFor(fn, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(room, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${room}`, { perMessageDeflate: false });
  const messages = [], units = new Map();
  const client = {
    ws, messages, room,
    latest: t => messages.filter(m => m.t === t).at(-1),
    async send(message) { await sendRead(ws, message); await settle(); },
    wait: (t, after = 0) => waitFor(() => messages.slice(after).find(m => m.t === t), `missing ${t}`),
  };
  clients.push(client);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'start') units.clear();
    if (m.t === 's') {
      for (const id of m.gone ?? []) units.delete(id);
      for (const row of m.units) units.set(row[0], row);
      m.units = [...units.values()];
    }
    messages.push(m);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token });
  await client.wait('lobby');
  return client;
}
async function tick(count = 2) {
  for (let i = 0; i < count; i++) server.tickRooms();
  // Advancing simulation is synchronous; receiving its WebSocket snapshots is not.
  // Wait for each client to catch up even when a large world fills the socket queue.
  await waitFor(() => clients.every(client => {
    const room = server.rooms.get(client.room), game = room?.game;
    return !game || (client.latest('s')?.tick ?? -1) >= game.tick - Math.max(4, room.snapEvery ?? 2) + 1;
  }), 'clients did not receive the final simulation snapshots');
}

try {
  const host = await connect('worldcheck', 'host');
  const guest = await connect('worldcheck', 'guest');
  await host.send({ t: 'mode', v: 'world' });
  assert.equal(host.latest('lobby').mode, 'world', 'host can select World Conquest');
  await host.send({ t: 'worldSize', v: 'huge' });
  await host.send({ t: 'start' });
  const start = await host.wait('start');
  const enemyStart = await guest.wait('start');
  assert.equal(start.map.world.total, 64, 'Huge starts a 64-region continent');
  assert.deepEqual([start.map.w, start.map.h], [512, 512], 'Huge spans 1,024 metres in both directions');
  assert.equal(start.spawns[1], null, 'enemy spawn coordinates stay secret');
  assert.equal(enemyStart.spawns[0], null, 'spawn secrecy applies to both sides');
  assert.equal(start.map.world.seed, undefined, 'the generation seed is not sent to clients');
  assert.deepEqual(start.map.points, [], 'legacy points do not reveal region locations');
  await tick();
  const state = await host.wait('s');
  assert.equal(state.world.owned, 1, 'each player starts with one home region');
  assert.ok(state.world.regions.length < 64, 'undiscovered regions are omitted');
  assert.ok(state.world.regions.every(r => Array.isArray(r.runs)), 'irregular territory exposes only explored runs');
  assert.equal(start.map.world.regionMap, undefined, 'authoritative membership stays secret');
  assert.equal(start.map.world.waterways, undefined, 'complete river network stays secret');
  assert.equal(state.world.waterways, undefined, 'snapshots never expose river network diagnostics');
  console.log('World Conquest start and discovery checks passed');

  // Arrange a nearby battle without waiting for a cross-continent march. All actions and assertions use clients.
  const game = server.rooms.get('worldcheck').game;
  const region = game.world.regions.find(r => r.team === -1);
  const base = [...game.units.values()].find(u => u.type === 'worldbase' && u.region === region.id);
  const rifle = [...game.units.values()].find(u => u.owner === 0 && u.type === 'rifle');
  const engineer = [...game.units.values()].find(u => u.owner === 0 && u.type === 'engineer');
  const guards = [...game.units.values()].filter(u => u.owner === -1 && !UNITS[u.type].building && Math.hypot(u.x - region.x, u.z - region.z) < 20);
  for (const u of game.units.values()) u.holdFire = true;
  guards.forEach((u, i) => Object.assign(u, { x: region.x + 12, z: region.z + 8 + i * 3, guardHome: { x: region.x + 12, z: region.z + 8 + i * 3 } }));
  Object.assign(rifle, { x: region.x, z: region.z });
  base.hp = 1;
  await tick(200);
  const known = () => host.latest('s').world.regions.find(r => r.id === region.id);
  assert.equal(known().locked, true, 'a surviving military base blocks occupation');
  assert.equal(known().team, -1, 'infantry cannot claim before the base falls');
  await host.send({ t: 'move', orders: [[rifle.id, region.x, region.z + 12]] });
  await tick(100);
  await host.send({ t: 'stance', ids: [rifle.id], key: 'holdFire', on: false });
  await host.send({ t: 'attack', ids: [rifle.id], target: base.id });
  await tick(100);
  assert.ok(!host.latest('s').units.some(u => u[0] === base.id), 'normal attacks destroy the regional base');
  assert.equal(known().team, -1, 'destruction alone does not grant land');
  await host.send({ t: 'stance', ids: [rifle.id], key: 'holdFire', on: true });
  await host.send({ t: 'move', orders: [[rifle.id, region.x, region.z]] });
  await tick(300);
  assert.equal(known().team, 0, 'infantry claims the cleared region');
  assert.equal(host.latest('s').world.owned, 2, 'conquest adds one region');
  assert.equal(host.latest('s').world.cap, 26, 'one conquered region adds two population capacity');
  for (const guard of guards) assert.equal(host.latest('s').units.find(u => u[0] === guard.id)?.[2], -1, 'surviving guards stay hostile');
  console.log('World Conquest destruction and infantry claim checks passed');

  Object.assign(engineer, { x: region.x + 5, z: region.z - 5 });
  game.players[0].mp = 1000;
  await tick(4);
  const funds = host.latest('s').mp;
  await host.send({ t: 'build', ids: [engineer.id], kind: 'barracks', x: region.x + 5, z: region.z - 8 });
  await tick(4);
  const site = host.latest('s').units.find(u => u[1] === 'barracks' && u[2] === 0);
  assert.ok(site, 'the player can build on conquered land');
  assert.ok(site[14] < 1, 'a paid building starts as a construction site');
  assert.ok(host.latest('s').mp < funds - 100, 'construction charges manpower');
  await tick(900);
  assert.equal(host.latest('s').units.find(u => u[0] === site[0])?.[14], 1, 'Engineers finish the construction site');
  const beforeRecruit = host.latest('s').mp;
  await host.send({ t: 'buy', unit: 'mg', from: site[0] });
  await tick(4);
  assert.ok(host.latest('s').queues.some(q => q[0] === site[0] && q.includes('mg')), 'recruitment enters the chosen building queue');
  assert.ok(host.latest('s').mp < beforeRecruit - 100, 'recruitment charges manpower');
  await tick(400);
  assert.ok(host.latest('s').units.some(u => u[1] === 'mg' && u[2] === 0), 'the trained squad belongs to its paying player');
  const after = guest.messages.length;
  await guest.send({ t: 'buy', unit: 'mg', from: site[0] });
  const denial = await guest.wait('deny', after);
  assert.ok(denial.reason, 'another player cannot use the building queue');
  console.log('World Conquest paid construction and recruitment checks passed');

  // Losing production must leave a paid way to recover while the team still owns land.
  for (const u of game.units.values()) if (u.owner === 0 && (u.type === 'hq' || u.type === 'engineer')) u.hp = 0;
  await tick(4);
  assert.equal(host.latest('s').out[0], false, 'HQ and Engineer loss does not defeat a landowner');
  const beforeHQ = host.latest('s').mp;
  await host.send({ t: 'recover' });
  await tick(4);
  const restoredHQ = host.latest('s').units.find(u => u[1] === 'hq' && u[2] === 0);
  assert.ok(restoredHQ, 'recovery restores an owned HQ');
  assert.ok(host.latest('s').mp < beforeHQ - 190, 'HQ recovery charges 200 manpower');
  const beforeEngineer = host.latest('s').mp;
  await host.send({ t: 'recover' });
  await tick(4);
  assert.ok(host.latest('s').queues.some(q => q[0] === restoredHQ[0] && q.includes('engineer')), 'Engineer recovery uses the HQ queue');
  assert.ok(host.latest('s').mp < beforeEngineer - 50, 'Engineer recovery charges 60 manpower');
  await tick(500);
  assert.ok(host.latest('s').units.some(u => u[1] === 'engineer' && u[2] === 0), 'paid recovery produces an Engineer');
  console.log('World Conquest paid recovery checks passed');
} finally {
  server.clock.setTimeout = () => null;
  for (const client of clients) client.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
