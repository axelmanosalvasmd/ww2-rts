import { memoryConnect, sendsReadBy } from './test-socket.js';
// World observation regressions. Socket messages and the public AI planning boundary carry assertions.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const source = process.env.WORLD_SOURCE_ROOT ? pathToFileURL(`${process.env.WORLD_SOURCE_ROOT}/`) : new URL('./', import.meta.url);
const { createGame, teamFog, CELL, UNITS } = await import(new URL('shared/sim.js', source));
const { generateWorldMap } = await import(new URL('shared/world-conquest.js', source));
const { observe, think } = await import(new URL('shared/ai.js', source));
Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import(new URL('server.js', source));
const sendRead = sendsReadBy(server.wss);
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
const clients = [], failures = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 12));
async function waitFor(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(label);
}
async function connect(token) {
  const ws = memoryConnect(server.wss, `/ws?room=obscheck`);
  const messages = [], rows = new Map();
  const c = { ws, latest: t => messages.filter(m => m.t === t).at(-1), async send(m) { await sendRead(ws, m); await settle(); } };
  clients.push(c);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'start' || (m.t === 's' && m.all)) rows.clear();
    if (m.t === 's') {
      for (const id of m.gone ?? []) rows.delete(id);
      for (const row of m.units) rows.set(row[0], row);
      m.units = [...rows.values()];
    }
    messages.push(m);
  });
  await c.send({ t: 'hello', token, name: token });
  await waitFor(() => c.latest('lobby'), 'socket joins the lobby');
  return c;
}
async function tick(n = 6) { for (let i = 0; i < n; i++) server.tickRooms(); await settle(); }
function place(u, x, z) { Object.assign(u, { x, z, path: [], orders: [], attackId: 0, targetId: 0, worldGoal: null, amove: null, retreating: false, holdPos: true }); }
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  await check('unseen regional contest and claim state stay remembered', async () => {
    const host = await connect('observer'), b = await connect('hiddenb'), c = await connect('hiddenc');
    await host.send({ t: 'mode', v: 'world' });
    await host.send({ t: 'weather', v: 'clear' });
    await host.send({ t: 'start' });
    await waitFor(() => host.latest('start') && b.latest('start') && c.latest('start'), 'all three sockets start');
    const g = server.rooms.get('obscheck').game;
    for (const u of g.units.values()) Object.assign(u, { holdFire: true, auto: false, autoRetreat: false });
    await tick();
    const r = g.world.regions.find(r => r.team === g.players[0].team);
    const delivered = () => host.latest('s').world.regions.find(q => q.id === r.id);
    const remembered = { progress: delivered().progress, capper: delivered().capper, contested: delivered().contested };
    for (const u of g.units.values()) if (u.owner === 0) u.hp = 0;
    const enemies = [1, 2].map(owner => [...g.units.values()].find(u => u.owner === owner && u.type === 'rifle'));
    enemies.forEach(u => place(u, r.x, r.z));
    await tick(12);
    const center = Math.floor(r.z / CELL) * g.w + Math.floor(r.x / CELL);
    assert.equal(teamFog(g, g.players[0].team).vis[center], 0, 'observer has no current vision of its region');
    assert.equal(host.latest('s').units.filter(u => u[2] !== 0).length, 0, 'socket receives no hidden enemy units');
    assert.equal(r.contested, true, 'two hidden hostile teams really contest the capture point');
    assert.deepEqual({ progress: delivered().progress, capper: delivered().capper, contested: delivered().contested }, remembered, 'hidden contest does not change delivered claim state');
    place(enemies[1], r.x + 40, r.z + 40);
    await tick(12);
    assert.ok(r.progress < remembered.progress, 'remaining hidden infantry really reduces ownership progress');
    assert.deepEqual({ progress: delivered().progress, capper: delivered().capper, contested: delivered().contested }, remembered, 'hidden capture progress does not update memory early');
    await tick(180);
    assert.equal(r.team, -1, 'hidden infantry removes the last owned region');
    assert.equal(delivered().team, -1, 'the socket still receives its real ownership loss');
    assert.equal(host.latest('s').world.owned, 0, 'the socket receives its current territorial total');
    assert.equal(delivered().capper, remembered.capper, 'ownership loss does not disclose the hidden claimant');
  });
  await check('AI pursues a remembered regional blocker and attacks after rediscovery', async () => {
    const g = createGame(generateWorldMap({ seed: 17, players: 2 }), ['AI', 'Enemy'], false, [0, 1], [0, 1], { mode: 'world', weather: false });
    const v = observe(g, 0);
    const r = { id: 5, name: 'Target', kind: 'rural', team: 1, x: 450, z: 450, bounds: [384, 384, 512, 512], locked: true, progress: 1, capper: -1, contested: false };
    v.world.regions = [r]; v.points = [{ ...r, owner: 1, vp: 1, mp: 1, cut: false }];
    const rifle = [...v.units.values()].find(u => u.type === 'rifle' && u.owner === 0);
    v.units.delete(rifle.id);
    const soldiers = [900, 901, 902];
    soldiers.forEach((id, i) => v.units.set(id, { ...structuredClone(rifle), id, x: 450 + i, z: 450, path: [], orders: [], attackId: 0, targetId: 0 }));
    const ghost = { id: 777, type: 'barracks', owner: 1, x: 505, z: 505, built: 1 };
    v.ghosts = [ghost]; v.knownBuildings = v.ghosts; v.players[0].visible = new Set();
    const calls = [];
    think(g, 0, { view: v, memory: {}, submit: cmd => { calls.push(cmd); return undefined; } });
    const marches = calls.filter(cmd => cmd.t === 'amove').flatMap(cmd => cmd.orders);
    assert.ok(marches.some(([id, x, z]) => soldiers.includes(id) && x === ghost.x && z === ghost.z), 'idle troops march toward the remembered blocking facility rather than stopping at the capture center');
    assert.ok(!calls.some(cmd => cmd.t === 'attack' && cmd.target === ghost.id), 'AI does not issue direct attack orders against an unseen Ghost');
    const visible = structuredClone(rifle);
    Object.assign(visible, ghost, { hp: UNITS.barracks.hpPer, queue: [], path: [], orders: [] });
    v.units.set(ghost.id, visible); v.players[0].visible = new Set([ghost.id]);
    const seenCalls = [];
    think(g, 0, { view: v, memory: {}, submit: cmd => { seenCalls.push(cmd); return undefined; } });
    assert.ok(seenCalls.some(cmd => cmd.t === 'attack' && cmd.target === ghost.id && cmd.ids.some(id => soldiers.includes(id))), 'rediscovered facility receives a normal direct attack order');
  });
} finally {
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
if (failures.length) process.exitCode = 1;
