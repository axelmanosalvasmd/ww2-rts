// Fixture placement is internal. Orders and trajectory observations use real WebSockets.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const liveTruthControl = process.argv.includes('--live-truth-control');
const liveCoverControl = process.argv.includes('--live-cover-control');
if (liveTruthControl || liveCoverControl) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/shared/sim.js')) return loaded;
  const source = String(loaded.source);
  const current = liveTruthControl ? 'clear: (a, b) => walkable(trafficView(),' : 'coverRank: at => def.infantry ? coverRank(trafficView(),';
  const replacement = liveTruthControl ? 'clear: (a, b) => walkable(g,' : 'coverRank: at => def.infantry ? coverRank({ ...trafficView(), wrecks: g.wrecks, cellHp: g.cellHp, trenchFront: g.trenchFront },';
  assert.equal(source.split(current).length, 2, 'the control replaces exactly one voluntary traffic reader');
  return { ...loaded, source: source.replace(current, replacement) };
} });
const projectRoot = process.env.WW2_TRAFFIC_ROOT ? pathToFileURL(`${process.env.WW2_TRAFFIC_ROOT}/`) : new URL('./', import.meta.url);
const sim = await import(new URL('./shared/sim.js', projectRoot));
Object.assign(process.env, { PORT: '0', EDIT_PASSWORD: 'test', PUBLIC_URL: 'http://test' });
const server = await import(new URL('./server.js', projectRoot));
clearInterval(server.loop);
if (!server.server.listening) await new Promise(resolve => server.server.once('listening', resolve));
server.clock.setTimeout = () => null;
const clients = [], fixtures = new Map(), originalRead = server.mapFiles.read, originalList = server.mapFiles.list;
server.mapFiles.list = async () => [...await originalList(), ...[...fixtures.keys()].map(name => `${name}.json`)];
server.mapFiles.read = name => fixtures.has(name) ? Promise.resolve(JSON.stringify(fixtures.get(name))) : originalRead(name);
const settle = () => new Promise(resolve => setTimeout(resolve, 8));
async function until(fn, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const value = fn(); if (value) return value; await settle(); }
  assert.fail(message);
}
async function connect(room, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.server.address().port}/ws?room=${room}`, { perMessageDeflate: true });
  const messages = [], rows = new Map(), terrain = new Map();
  const client = { ws, token, messages, terrain, wrecks: [], latest: type => messages.filter(message => message.t === type).at(-1),
    async send(message) { ws.send(JSON.stringify(message)); await settle(); },
    wait: type => until(() => messages.find(message => message.t === type), `missing ${type}`) };
  clients.push(client);
  ws.on('message', data => {
    const message = JSON.parse(data);
    for (const cell of message.cells ?? []) terrain.set(cell[0], cell);
    if (message.t === 's') {
      if (message.wrecks) client.wrecks = message.wrecks;
      if (message.all) rows.clear();
      for (const id of message.gone ?? []) rows.delete(id);
      for (const row of message.units) rows.set(row[0], row);
      message.units = [...rows.values()];
    }
    messages.push(message);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await client.send({ t: 'hello', token, name: token }); await client.wait('lobby');
  return client;
}
async function tick(room, seats, count = 2) {
  for (let n = 0; n < count; n++) server.tickRooms();
  await settle();
  const every = room.snapEvery ?? 2, target = room.game.tick - room.game.tick % every;
  for (const seat of seats) await until(() => seat.latest('s')?.tick >= target, 'WebSocket snapshot catches up');
}
function place(unit, x, z) {
  Object.assign(unit, { x, z, path: [], orders: [], attackId: 0, targetId: 0, worldGoal: null, amove: null,
    build: 0, retreating: false, holdPos: true, holdFire: true, auto: false, autoRetreat: false,
    still: 5, rot: 0, aim: 0, speed: 0, moveSpeed: 0, vx: 0, vz: 0 });
}
function authoredMap() {
  const rows = Array(96).fill('.'.repeat(96)); rows[29] = 'H'.repeat(96);
  return { name: 'Hidden traffic fixture', w: 96, h: 96, rows,
    spawns: [{ x: 8, y: 8 }, { x: 87, y: 87 }], points: [{ id: 'remote', x: 80, y: 80 }] };
}
async function trajectory(code, mutateHidden) {
  const map = authoredMap(), name = `traffic-${code}`; fixtures.set(name, map);
  assert.equal(sim.validateMap(map), null);
  const seats = [await connect(code, `${code}0`), await connect(code, `${code}1`)], owner = seats[0];
  await owner.send({ t: 'map', name }); await owner.send({ t: 'mode', v: 'classic' });
  await owner.send({ t: 'weather', v: 'clear' }); await owner.send({ t: 'start' });
  for (const seat of seats) await seat.wait('start');
  const room = server.rooms.get(code), g = room.game;
  const template = [...g.units.values()].find(unit => unit.owner === 0 && unit.type === 'rifle');
  for (const [id, unit] of g.units) {
    if (unit.type !== 'hq') g.units.delete(id);
    else Object.assign(unit, { holdFire: true, auto: false, holdPos: true });
  }
  function actor(type, x, z) {
    const unit = structuredClone(template);
    Object.assign(unit, { id: g.nextId++, type, hp: sim.UNITS[type].hpPer * sim.UNITS[type].models });
    place(unit, x, z); g.units.set(unit.id, unit); return unit;
  }
  // Ground units see unconditionally within six metres. One metre north keeps
  // the cell at (41,61) beyond that radius while the passing clearance reaches it.
  const tank = actor('tank', 40, 55), blocker = actor('rifle', 46, 55), hiddenCell = 30 * g.w + 20;
  await tick(room, seats, 8);
  assert.equal(owner.latest('start').map.rows[30][20], '.', 'both clients start with the same authored open cell');
  assert.equal(sim.teamFog(g, 0).vis[hiddenCell], 0, 'the hedge hides the prospective positive-side rubble');
  const knownBefore = owner.terrain.get(hiddenCell), before = owner.latest('s').units.find(row => row[0] === tank.id);
  assert.deepEqual(before.slice(3, 6), [40, 55, 0]);
  if (mutateHidden) assert(sim.mutateWorldCell(g, hiddenCell, { object: 'R' }));
  await tick(room, seats);
  assert.equal(sim.teamFog(g, 0).vis[hiddenCell], 0);
  assert.deepEqual(owner.terrain.get(hiddenCell), knownBefore, 'the recipient receives no hidden terrain change');
  tank.holdPos = false;
  await owner.send({ t: 'move', orders: [[tank.id, 80, 55]] });
  assert(!owner.messages.some(message => message.t === 'deny'), 'ordinary WebSocket movement is accepted');
  const response = [];
  for (let n = 0; n < 12; n++) {
    await tick(room, seats);
    const snapshot = owner.latest('s'), row = snapshot.units.find(unit => unit[0] === tank.id);
    assert(row && row.slice(3, 7).every(Number.isFinite), 'the client receives a finite hull transform');
    // At the first voluntary turn, the tank remains safely before both actors
    // and the hidden rubble. A later contact cannot explain the initial choice.
    const distance = Math.hypot(row[3] - blocker.x, row[4] - blocker.z);
    assert(distance > sim.UNITS.tank.radius * 0.8 + sim.UNITS.rifle.radius * 0.8 + 0.5, 'proof ends before actor contact');
    assert(row[4] < 58, 'proof ends before contact with the positive-side hidden cell');
    assert.equal(sim.teamFog(g, 0).vis[hiddenCell], 0, 'the changed cell stays unobserved through the choice');
    assert.deepEqual(owner.terrain.get(hiddenCell), knownBefore);
    response.push({ tick: snapshot.tick, x: row[3], z: row[4], rot: row[5] });
    if (Math.abs(row[5]) > 0.01) break;
  }
  assert(Math.abs(response.at(-1).rot) > 0.01, 'a real voluntary hull response occurred');
  server.rooms.delete(code);
  for (const seat of seats) seat.ws.terminate();
  return response;
}

async function coverTrajectory(code, hiddenWreck) {
  const map = authoredMap(), name = `traffic-${code}`;
  map.rows[29] = '.'.repeat(map.w); map.rows[26] = map.rows[28] = 'H'.repeat(map.w);
  fixtures.set(name, map); assert.equal(sim.validateMap(map), null);
  const seats = [await connect(code, `${code}0`), await connect(code, `${code}1`)], owner = seats[0];
  await owner.send({ t: 'map', name }); await owner.send({ t: 'mode', v: 'classic' });
  await owner.send({ t: 'weather', v: 'clear' }); await owner.send({ t: 'start' });
  for (const seat of seats) await seat.wait('start');
  const room = server.rooms.get(code), g = room.game;
  const template = [...g.units.values()].find(unit => unit.owner === 0 && unit.type === 'rifle');
  for (const [id, unit] of g.units) {
    if (unit.type !== 'hq') g.units.delete(id);
    else Object.assign(unit, { holdFire: true, auto: false, holdPos: true });
  }
  function actor(type, x, z) {
    const unit = structuredClone(template);
    Object.assign(unit, { id: g.nextId++, type, hp: sim.UNITS[type].hpPer * sim.UNITS[type].models });
    place(unit, x, z); g.units.set(unit.id, unit); return unit;
  }
  // The vehicle's lower stable ID wins opposing traffic. The rifle first tries
  // the negative-z side, then the positive-z side. Known hedges shelter its
  // original position and positive candidate from its remembered fire direction.
  const vehicle = actor('tank', 46, 55), rifle = actor('rifle', 40, 55);
  vehicle.rot = Math.PI; rifle.hitFrom = { x: 40, z: 0 };
  const wreck = { id: 900000, type: 'tank', owner: 1, x: 39.2, z: 47.8, rot: 0, c: -1 };
  const hiddenCell = 23 * g.w + 19;
  await tick(room, seats, 8);
  assert.equal(sim.teamFog(g, 0).vis[hiddenCell], 0, 'the hedge hides the wreck beyond unconditional six-metre sight');
  const terrainBefore = owner.terrain.get(hiddenCell);
  if (hiddenWreck) g.wrecks.push(wreck);
  await tick(room, seats);
  assert(!owner.wrecks.some(row => row[0] === wreck.id), 'the recipient has no hidden wreck metadata');
  assert.deepEqual(owner.terrain.get(hiddenCell), terrainBefore);
  vehicle.holdPos = rifle.holdPos = false;
  await owner.send({ t: 'move', orders: [[vehicle.id, 20, 55], [rifle.id, 80, 55]] });
  assert(!owner.messages.some(message => message.t === 'deny'), 'ordinary infantry and opposing vehicle moves are accepted');
  const response = [];
  for (let n = 0; n < 12; n++) {
    await tick(room, seats);
    const snapshot = owner.latest('s'), row = snapshot.units.find(unit => unit[0] === rifle.id);
    const blocker = snapshot.units.find(unit => unit[0] === vehicle.id);
    assert(row && blocker && row.slice(3, 7).every(Number.isFinite));
    assert(Math.hypot(row[3] - blocker[3], row[4] - blocker[4]) > 3.7, 'the public yield response precedes physical actor contact');
    assert(Math.hypot(row[3] - wreck.x, row[4] - wreck.z) > 6, 'the proof precedes wreck observation or contact');
    assert.equal(sim.teamFog(g, 0).vis[hiddenCell], 0);
    assert(!owner.wrecks.some(value => value[0] === wreck.id));
    assert.deepEqual(owner.terrain.get(hiddenCell), terrainBefore);
    response.push({ tick: snapshot.tick, x: row[3], z: row[4], rot: row[5] });
    if (Math.abs(row[4] - 55) > 0.01) break;
  }
  assert(Math.abs(response.at(-1).z - 55) > 0.01, `an ordinary infantry move produces a voluntary side response: ${JSON.stringify(response)}`);
  server.rooms.delete(code); for (const seat of seats) seat.ws.terminate();
  return response;
}

try {
  if (!liveCoverControl) {
  const open = await trajectory('open', false), hidden = await trajectory('hidden', true);
  if (liveTruthControl) {
    assert(open.at(-1).rot > 0 && hidden.at(-1).rot < 0, `reading live hidden terrain reverses the voluntary choice: ${JSON.stringify({ open, hidden })}`);
    console.log('PASS live-truth control: opposite sides before contact', JSON.stringify({ open, hidden }));
  } else {
    assert(open.at(-1).rot > 0, 'the stable actor order selects the positive side');
    assert.deepEqual(hidden, open, 'unobserved terrain cannot change the initial voluntary trajectory');
    console.log('PASS traffic privacy: identical client trajectories before contact', JSON.stringify({ open, hidden }));
    const control = spawnSync(process.execPath, [import.meta.filename, '--live-truth-control'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(control.status, 0, `live-truth regression control failed: ${control.stdout}\n${control.stderr}`);
    assert(control.stdout.includes('opposite sides before contact'));
    console.log(control.stdout.trim());
  }
  }
  if (!liveTruthControl) {
    const open = await coverTrajectory('coveropen', false), hidden = await coverTrajectory('coverhidden', true);
    if (liveCoverControl) {
      assert(open.at(-1).z > 55 && hidden.at(-1).z < 55, `live hidden cover reverses infantry yield: ${JSON.stringify({ open, hidden })}`);
      console.log('PASS live-cover control: opposite infantry sides before contact', JSON.stringify({ open, hidden }));
    } else {
      assert(open.at(-1).z > 55, 'known cover permits the positive side');
      assert.deepEqual(hidden, open, 'hidden wreck metadata cannot change the ordinary infantry yield response');
      console.log('PASS cover privacy: identical infantry client trajectories before contact', JSON.stringify({ open, hidden }));
      const control = spawnSync(process.execPath, [import.meta.filename, '--live-cover-control'], { encoding: 'utf8', timeout: 30000 });
      assert.equal(control.status, 0, `live-cover regression control failed: ${control.stdout}\n${control.stderr}`);
      assert(control.stdout.includes('opposite infantry sides before contact')); console.log(control.stdout.trim());
    }
  }
} finally {
  server.mapFiles.read = originalRead; server.mapFiles.list = originalList;
  for (const client of clients) client.ws.terminate();
  for (const ws of server.wss.clients) ws.terminate();
  server.rooms.clear();
  await new Promise(resolve => server.wss.close(resolve));
  await new Promise(resolve => server.server.close(resolve));
}
