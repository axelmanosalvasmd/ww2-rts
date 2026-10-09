import { memoryConnect } from './test-socket.js';
// Real room commands and recipient snapshots exercise movement under a controlled clock.
import assert from 'node:assert/strict';
import { CELL, TERRAIN, UNITS, TICK, RIDING_FLAG } from './shared/sim.js';
import { vehiclePositionClear, VEHICLE_PROFILES } from './shared/vehicle-motion.js';
Object.assign(process.env, { PORT: '0', HOST: '127.0.0.1', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import('./server.js');
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
let nonce = 0;
const clients = [];
async function until(fn, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const result = fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail(label);
}
async function connect(name) {
  const ws = memoryConnect(server.wss, `/ws?room=enginemove`);
  const c = { ws, rows: new Map(), pongs: new Set(), denies: [] }; clients.push(c);
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 'start') c.started = m;
    if (m.t === 'pong') c.pongs.add(m.c);
    if (m.t === 'deny') c.denies.push(m);
    if (m.t === 's') { if (m.all) c.rows.clear(); for (const id of m.gone ?? []) c.rows.delete(id); for (const row of m.units) c.rows.set(row[0], row); c.snapshot = m; }
  });
  c.send = message => ws.send(JSON.stringify(message));
  c.barrier = async () => { const id = ++nonce; c.send({ t: 'ping', c: id }); await until(() => c.pongs.delete(id), 'command barrier'); };
  c.send({ t: 'hello', name, token: name }); await until(() => c.lobby, 'lobby'); return c;
}
async function tick(n = 2) {
  for (let i = 0; i < n; i++) { server.tickRooms(); await new Promise(resolve => setImmediate(resolve)); }
  await new Promise(resolve => setTimeout(resolve, 1));
}
try {
  const host = await connect('movement-host'); const rival = await connect('movement-rival');
  host.send({ t: 'start' }); await host.barrier(); await until(() => host.started, 'start');
  const g = server.rooms.get('enginemove').game, template = structuredClone([...g.units.values()].find(u => u.type === 'rifle'));
  const fixture = () => {
    g.units.clear(); g.points = []; g.fires.clear(); g.wrecks = []; g.winner = null;
    for (let c = 0; c < g.chars.length; c++) { g.chars[c] = '.'; g.flags[c] = TERRAIN['.']; if (g.height) g.height[c] = 0; g.cellHp[c] = 0; g.wear[c] = 0; }
    g.initialTerrain = { chars: [...g.chars], height: new Int8Array(g.height ?? g.chars.length) };
    g.cellLog = []; g.cellLogIndexes = new Map(); for (const p of g.players) { p.terrainMemory = new Map(); p.terrainPending = new Set(); }
    g.terrainVersion = (g.terrainVersion ?? 0) + 1; g.infantryRegionVersion = (g.infantryRegionVersion ?? 0) + 1; g.vehicleRegionVersion = (g.vehicleRegionVersion ?? 0) + 1;
  };
  const put = (type, x, z, owner = 0) => {
    const u = { ...structuredClone(template), id: g.nextId++, type, owner, x, z, hp: UNITS[type].models * UNITS[type].hpPer, holdFire: true, auto: false, autoRetreat: false, path: [], orders: [], moveSpeed: 0, vx: 0, vz: 0, worldGoal: null, traffic: null, face: null, rot: 0 };
    g.units.set(u.id, u); return u;
  };
  const move = async (u, x, z, extra = {}) => { host.send({ t: 'move', orders: [[u.id, x, z]], ...extra }); await host.barrier(); };
  fixture();
  const tank = put('tank', 30, 30), foot = put('rifle', 30, 42);
  await tick(4); await move(tank, 80, 30); await move(foot, 80, 42);
  await tick(2);
  let row = host.rows.get(tank.id), infantry = host.rows.get(foot.id);
  assert.ok(row[15] > 0 && row[15] < UNITS.tank.speed, 'the vehicle accelerates from rest');
  assert.ok(infantry[3] - 30 > 0.3, 'infantry moves promptly on the next authoritative steps');
  await tick(35);
  const beforeStop = host.rows.get(tank.id), speed = beforeStop[15];
  host.send({ t: 'stop', ids: [tank.id] }); await host.barrier(); await tick(2);
  row = host.rows.get(tank.id);
  assert.ok(row[3] > beforeStop[3] && row[15] > 0 && row[15] < speed, 'Stop cancels the order and applies finite braking');
  const stopX = row[3]; await tick(50); row = host.rows.get(tank.id);
  assert.equal(row[15], 0, 'Stop reaches zero speed');
  assert.ok(row[3] - stopX <= speed * speed / (2 * VEHICLE_PROFILES.tank.braking) + 1, 'stopping distance stays inside the measured profile bound');
  assert.equal(host.snapshot.plans.find(p => p[0] === tank.id)[1], 0, 'a stopped vehicle has no resumed travel order');

  fixture();
  const reversing = put('tank', 40, 30); reversing.hitFrom = { x: 75, z: 30 }; reversing.hitAt = g.tick;
  await tick(4); await move(reversing, 30, 30); await tick(24);
  row = host.rows.get(reversing.id);
  assert.ok(row[3] < 38 && row[15] < 0, 'an engaged tank accelerates into a short reverse');
  assert.ok(Math.cos(row[5]) > 0.99, 'reverse preserves the hull facing toward the threat');

  fixture();
  const laneTank = put('tank', 40, 56), yieldingGun = put('at', 66, 56); laneTank.holdPos = yieldingGun.holdPos = true;
  await tick(4); await move(laneTank, 80, 56); await move(yieldingGun, 20, 56);
  let yielded = false;
  for (let n = 0; n < 300 && !yielded; n += 2) { await tick(2); yielded = Math.abs(host.rows.get(yieldingGun.id)[4] - 56) > 1; }
  assert.ok(yielded, 'opposing traffic takes a stable local yield');
  await move(yieldingGun, 66, 72); await tick(4);
  assert.deepEqual(host.snapshot.plans.find(p => p[0] === yieldingGun.id).slice(1, 4), [1, 66, 72], 'a new order immediately replaces the retained goal during a yield');
  host.send({ t: 'stop', ids: [yieldingGun.id] }); await host.barrier(); await tick(4);
  const stoppedGun = host.rows.get(yieldingGun.id).slice(3, 5); await tick(30);
  assert.deepEqual(host.rows.get(yieldingGun.id).slice(3, 5), stoppedGun, 'Stop interrupts an infantry support gun without resuming the yield');
  host.send({ t: 'retreat', ids: [yieldingGun.id] }); await host.barrier(); await tick(4);
  assert.equal(host.snapshot.plans.find(p => p[0] === yieldingGun.id)[1], 3, 'Retreat immediately replaces voluntary traffic control');
  assert.ok(host.rows.get(yieldingGun.id)[12] & 1, 'Retreat retains its protection flag');

  fixture();
  const passingTank = put('tank', 40, 56), parkedFoot = put('rifle', 56, 56); parkedFoot.holdPos = true;
  await tick(4); await move(passingTank, 70, 56);
  let passed = false;
  for (let n = 0; n < 600 && !passed; n += 4) { await tick(4); const r = host.rows.get(passingTank.id); passed = Math.hypot(r[3] - 70, r[4] - 56) < 0.5 && r[15] === 0; }
  assert.ok(passed, 'a tank passes a stationary protected unit and resumes its retained destination');
  assert.deepEqual(host.rows.get(parkedFoot.id).slice(3, 5), [56, 56], 'passing never displaces the protected blocker');
  fixture();
  const leavingHQ = put('rifle', 40, 40), homeHQ = put('hq', 44, 38), homeEngineer = put('engineer', 48, 38);
  homeEngineer.holdPos = true;
  await tick(4); await move(leavingHQ, 76, 38);
  let leftBase = false;
  for (let n = 0; n < 500 && !leftBase; n += 4) {
    await tick(4); const row = host.rows.get(leavingHQ.id);
    leftBase = Math.hypot(row[3] - 76, row[4] - 38) < 2;
  }
  assert.ok(leftBase, 'a squad passes its HQ when another infantry squad occupies the proposed exit');
  assert.deepEqual(host.rows.get(homeEngineer.id).slice(3, 5), [48, 38], 'the holding engineer is not displaced');
  assert.deepEqual(host.rows.get(homeHQ.id).slice(3, 5), [44, 38], 'the HQ remains fixed');
  fixture();
  const turning = put('tank', 30, 30);

  const wall = 16;
  for (let y = 11; y < 16; y++) { const c = y * g.w + wall; g.chars[c] = 'B'; g.flags[c] = TERRAIN.B; g.cellHp[c] = 1e6; }
  g.initialTerrain = { chars: [...g.chars], height: new Int8Array(g.height ?? g.chars.length) };
  g.infantryRegionVersion++; g.vehicleRegionVersion++;
  await tick(4); await move(turning, 48, 42);
  let arrived = false, previous = host.rows.get(turning.id);
  for (let n = 0; n < 600 && !arrived; n += 2) {
    await tick(2); row = host.rows.get(turning.id);
    const delta = Math.atan2(Math.sin(row[5] - previous[5]), Math.cos(row[5] - previous[5]));
    assert.ok(Math.abs(delta) <= VEHICLE_PROFILES.tank.hullTurn * TICK * 2 + 0.12, 'hull turning stays finite');
    assert.ok(vehiclePositionClear(g, { x: row[3], z: row[4], rot: row[5] }, { ...UNITS.tank, radius: UNITS.tank.radius - 0.15 }, 65), 'the delivered hull footprint stays clear within snapshot rounding precision');
    arrived = Math.hypot(row[3] - 48, row[4] - 42) < 0.5 && row[15] === 0; previous = row;
  }
  if (!arrived) console.log('TURN FAILURE',{x:turning.x,z:turning.z,path:turning.path,rot:turning.rot,speed:turning.moveSpeed,stuck:turning.stuck,wait:turning.trafficWait});
  assert.ok(arrived, 'the tank clears the corner and completes its move');

  fixture();
  // A six-metre deck cannot pass a tank and a support gun side by side. Banks provide yielding space.
  for (let y = 0; y < g.h; y++) for (let x = 29; x <= 35; x++) if (y < 27 || y > 29) { const c = y * g.w + x; g.chars[c] = 'W'; g.flags[c] = TERRAIN.W; }
  g.initialTerrain = { chars: [...g.chars], height: new Int8Array(g.height ?? g.chars.length) };
  g.infantryRegionVersion++; g.vehicleRegionVersion++;
  const crossing = [put('tank', 44, 57), put('at', 86, 57), put('rifle', 40, 51), put('rifle', 92, 63)];
  const goals = [[92, 57], [40, 57], [92, 53], [40, 61]];
  const defender = put('rifle', 52, 47); defender.holdPos = true; const dc = Math.floor(defender.z / CELL) * g.w + Math.floor(defender.x / CELL); g.chars[dc] = 'T'; g.flags[dc] = TERRAIN.T;
  await tick(4);
  for (let i = 0; i < crossing.length; i++) await move(crossing[i], ...goals[i]);
  let completed = false;
  for (let n = 0; n < 2400 && !completed; n += 4) {
    await tick(4);
    completed = crossing.every((u, i) => { const r = host.rows.get(u.id); return r && Math.hypot(r[3] - goals[i][0], r[4] - goals[i][1]) < 3; });
    assert.ok((host.snapshot.movement ?? []).every(m => m[1] !== 'unreachable'), 'traffic alone never reports an unreachable order');
  }
  if (!completed) console.log('CROSSING FAILURE', crossing.map(u => ({ id:u.id, x:u.x,z:u.z, path:u.path,goal:u.worldGoal,traffic:u.traffic,wait:u.trafficWait,stuck:u.stuck })));
  assert.ok(completed, 'all two-way crossing orders complete within 120 simulation seconds');
  assert.deepEqual(host.rows.get(defender.id).slice(3, 5), [52, 47], 'traffic preserves a defender holding protected cover');
  assert.equal(host.denies.length + rival.denies.length, 0, 'acceptance commands use the normal accepted protocol');
  fixture();
  for (let y = 0; y < g.h; y++) for (let x = 29; x <= 35; x++) if (y < 27 || y > 29) { const c = y * g.w + x; g.chars[c] = 'W'; g.flags[c] = TERRAIN.W; }
  g.initialTerrain = { chars: [...g.chars], height: new Int8Array(g.height ?? g.chars.length) };
  g.infantryRegionVersion++; g.vehicleRegionVersion++;
  // Contact can leave a squad near the deck edge. Smoothing must retain its safe step onto land.
  const bankFoot = put('rifle', 71.324, 59.081);
  await tick(4); await move(bankFoot, 92, 64); await tick(200);
  row = host.rows.get(bankFoot.id);
  assert.ok(Math.hypot(row[3] - 92, row[4] - 64) < 0.5, 'a squad displaced near a bank reaches its diagonal destination without cutting through water');
  fixture();
  const blocked = put('rifle', 30, 30); g.pathRetryLimit = 3;
  for (let y = 0; y < g.h; y++) { const c = y * g.w + 25; g.chars[c] = 'W'; g.flags[c] = TERRAIN.W; }
  g.initialTerrain = { chars: [...g.chars], height: new Int8Array(g.height ?? g.chars.length) };
  g.infantryRegionVersion++; g.vehicleRegionVersion++; await tick(4);
  await move(blocked, 70, 30); await move(blocked, 20, 30, { queue: true });
  let recovered = false, unreachable = false;
  for (let n = 0; n < 300 && !recovered; n += 2) {
    await tick(2); unreachable ||= (host.snapshot.movement ?? []).some(m => m[0] === blocked.id && (m[1] === 'unreachable' || m[3] === 'unreachable'));
    const r = host.rows.get(blocked.id); recovered = Math.hypot(r[3] - 20, r[4] - 30) < 0.5;
  }
  assert.ok(unreachable, 'only a known disconnected route ends as unreachable');
  assert.ok(recovered, 'a waiting order starts after a genuine unreachable result');
  fixture();
  const deadRequest = put('rifle', 30, 30), liveRequest = put('rifle', 30, 44);
  await tick(4); await move(deadRequest, 90, 30); await move(liveRequest, 90, 44);
  deadRequest.path = []; liveRequest.path = []; g.pathBudget = 0;
  await tick(2); // Both retained move goals are queued behind the empty per-tick budget.
  assert.equal(liveRequest.path.length, 0, 'the living request waits while the search budget is zero');
  assert.equal(host.rows.get(liveRequest.id)[3], 30, 'the delivered unit stays still before its deferred search');
  deadRequest.hp = 0; g.pathBudget = 1; await tick(1);
  assert.equal(deadRequest.path.length, 0, 'dead deferred work is discarded before searching');
  assert.deepEqual(liveRequest.path.at(-1), { x: 90, z: 44 }, 'the living request receives the only available search');
  g.pathBudget = 0; await tick(1);
  assert.ok(host.rows.get(liveRequest.id)[3] > 30.1, 'a dead deferred request cannot consume the one search available to a living move');
  g.pathBudget = 4096;
  fixture(); g.naval = true;
  for (let y = 0; y < g.h; y++) for (let x = 10; x < 35; x++) {
    const c = y * g.w + x; g.chars[c] = 'W'; g.flags[c] = TERRAIN.W;
    if (g.ground) g.ground[c] = 'W'; if (g.objects) g.objects[c] = '.';
  }
  g.initialTerrain = { chars: [...g.chars], ground: g.ground ? [...g.ground] : undefined, objects: g.objects ? [...g.objects] : undefined, height: new Int8Array(g.height ?? g.chars.length) };
  g.infantryRegionVersion++; g.vehicleRegionVersion++;
  const landingCraft = put('lcvp', 21, 31), passenger = put('rifle', 11, 31);
  await tick(4); host.send({ t: 'board', ids: [passenger.id], target: landingCraft.id }); await host.barrier(); await tick(400);
  assert.ok(host.rows.get(passenger.id)[12] & RIDING_FLAG, 'an explicit boarding order approaches its selected carrier within the original twenty seconds');
  assert.deepEqual(host.rows.get(passenger.id).slice(3, 5), host.rows.get(landingCraft.id).slice(3, 5), 'the delivered passenger rides at the carrier position');
  await move(landingCraft, 71, 31); await tick(240);
  assert.ok(host.rows.get(landingCraft.id)[3] >= 68, 'the loaded landing craft crosses on its unchanged naval route');
  host.send({ t: 'unload', ids: [landingCraft.id] }); await host.barrier(); await tick(4);
  assert.ok(!(host.rows.get(passenger.id)[12] & RIDING_FLAG), 'the passenger leaves the carrier at the far shore');
  assert.ok(host.rows.get(passenger.id)[3] >= 70, 'the passenger unloads onto the far bank');
  assert.equal(host.denies.length + rival.denies.length, 0, 'boarding and unloading use accepted normal room commands');
  console.log('PASS response/braking, short reverse, control interruption, swept turn, two-way crossing, protected passing, shoreline recovery, bounded queue recovery and naval boarding');
} finally {
  server.clock.setTimeout = () => null;
  for (const c of clients) c.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear(); await new Promise(resolve => server.wss.close(resolve)); await new Promise(resolve => server.server.close(resolve));
}
